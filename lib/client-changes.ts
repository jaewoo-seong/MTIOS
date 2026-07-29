import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  clientChangeApplications,
  clientChangeApprovals,
  clientChangeItems,
  clientChangeSets,
  clientChangeSnapshots,
  clientDatabases,
  clientRecords,
  reviewDecisions,
  reviews
} from "@/lib/db/schema";
import { MTI_OPERATOR_ID, MTI_ORGANIZATION_ID, repository } from "@/lib/repository";

export type ClientChangeOperation = "insert" | "update" | "delete" | "merge";
export type ClientChangeItemInput = {
  operation: ClientChangeOperation;
  recordId?: string | null;
  mergeRecordId?: string | null;
  after?: Record<string, string> | null;
  sourceEvidenceIds?: string[];
  confidence?: number;
  validationWarnings?: string[];
  duplicateRecordIds?: string[];
};
type MemoryItem = ClientChangeItemInput & {
  id: string;
  changeSetId: string;
  recordId: string;
  before: Record<string, string> | null;
  mergeBefore: Record<string, string> | null;
  after: Record<string, string> | null;
  changedFields: string[];
  status: string;
  decisionNote: string | null;
  position: number;
};
type MemorySet = {
  id: string;
  organizationId: string;
  projectId: string;
  agendaId: string | null;
  runId: string | null;
  databaseId: string;
  reviewId: string | null;
  title: string;
  reason: string;
  status: string;
  revision: number;
  contentHash: string;
  idempotencyKey: string;
  expiresAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  appliedAt: string | null;
  rolledBackAt: string | null;
};
type ClientChangeMemory = {
  sets: MemorySet[];
  items: MemoryItem[];
  reviews: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  applications: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown>>;
};
const globalChanges = globalThis as typeof globalThis & { __clientChangeMemory?: ClientChangeMemory };
const memory: ClientChangeMemory = globalChanges.__clientChangeMemory ??= {
  sets: [], items: [], reviews: [], decisions: [], approvals: [], applications: [], snapshots: []
};

export async function createClientChangeSet(input: {
  projectId: string;
  agendaId?: string | null;
  runId?: string | null;
  databaseId: string;
  title: string;
  reason?: string;
  idempotencyKey: string;
  expiresInSeconds?: number;
  items: ClientChangeItemInput[];
}) {
  const existing = await findByIdempotency(input.idempotencyKey);
  if (existing) return existing;
  const databases = await repository.listClientDatabases();
  if (!databases.some((database) => database.id === input.databaseId)) {
    throw new Error("Client database not found.");
  }
  if (!await repository.getProject(input.projectId)) throw new Error("Project not found.");
  const id = randomUUID();
  const normalized = await normalizeItems(id, input.databaseId, input.items);
  const contentHash = hashProposal(normalized);
  const expiresAt = new Date(Date.now() + (input.expiresInSeconds ?? 86400) * 1000);
  if (!db) {
    const set: MemorySet = {
      id,
      organizationId: MTI_ORGANIZATION_ID,
      projectId: input.projectId,
      agendaId: input.agendaId ?? null,
      runId: input.runId ?? null,
      databaseId: input.databaseId,
      reviewId: null,
      title: input.title,
      reason: input.reason ?? "",
      status: "draft",
      revision: 1,
      contentHash,
      idempotencyKey: input.idempotencyKey,
      expiresAt: expiresAt.toISOString(),
      approvedAt: null,
      approvedBy: null,
      appliedAt: null,
      rolledBackAt: null
    };
    memory.sets.push(set);
    memory.items.push(...normalized);
    return detail(set, normalized);
  }
  return db.transaction(async (tx) => {
    const [set] = await tx.insert(clientChangeSets).values({
      id,
      organizationId: MTI_ORGANIZATION_ID,
      projectId: input.projectId,
      agendaId: input.agendaId ?? null,
      runId: input.runId ?? null,
      databaseId: input.databaseId,
      title: input.title,
      reason: input.reason ?? "",
      contentHash,
      idempotencyKey: input.idempotencyKey,
      expiresAt
    }).returning();
    const rows = await tx.insert(clientChangeItems).values(normalized.map((item) => ({
      id: item.id,
      changeSetId: id,
      operation: item.operation,
      recordId: item.recordId,
      mergeRecordId: item.mergeRecordId ?? null,
      before: item.before,
      mergeBefore: item.mergeBefore,
      after: item.after,
      changedFields: item.changedFields,
      sourceEvidenceIds: item.sourceEvidenceIds ?? [],
      confidence: item.confidence ?? 0,
      validationWarnings: item.validationWarnings ?? [],
      duplicateRecordIds: item.duplicateRecordIds ?? [],
      status: item.status,
      position: item.position
    }))).returning();
    return { ...set, items: rows };
  });
}

async function normalizeItems(
  changeSetId: string,
  databaseId: string,
  inputs: ClientChangeItemInput[]
): Promise<MemoryItem[]> {
  if (inputs.length === 0) throw new Error("At least one change item is required.");
  const items: MemoryItem[] = [];
  for (const [position, input] of inputs.entries()) {
    const recordId = input.recordId ?? randomUUID();
    const current = input.operation === "insert"
      ? null
      : await repository.getRecord(databaseId, recordId);
    if (input.operation !== "insert" && !current) {
      throw new Error(`Record ${recordId} not found.`);
    }
    const merge = input.operation === "merge" && input.mergeRecordId
      ? await repository.getRecord(databaseId, input.mergeRecordId)
      : null;
    if (input.operation === "merge" && (!input.mergeRecordId || !merge)) {
      throw new Error("Merge source record not found.");
    }
    const before = current?.data ?? null;
    const after = input.operation === "delete" ? null : input.after ?? before;
    if ((input.operation === "insert" || input.operation === "update" || input.operation === "merge") && !after) {
      throw new Error(`${input.operation} requires proposed values.`);
    }
    items.push({
      ...input,
      id: randomUUID(),
      changeSetId,
      recordId,
      mergeRecordId: input.mergeRecordId ?? null,
      before,
      mergeBefore: merge?.data ?? null,
      after,
      changedFields: changedFields(before, after),
      status: "pending",
      decisionNote: null,
      position
    });
  }
  return items;
}

export async function submitClientChangeSet(id: string) {
  const current = await getClientChangeSet(id);
  if (!current) return null;
  if (!["draft", "changes_requested", "needs_research"].includes(current.status)) {
    throw new Error("Change set cannot be submitted from its current state.");
  }
  if (new Date(current.expiresAt) <= new Date()) throw new Error("Change set expired.");
  const reviewId = randomUUID();
  if (!db) {
    memory.reviews.push({
      id: reviewId,
      projectId: current.projectId,
      subjectType: "client_change_set",
      subjectId: id,
      status: "pending"
    });
    const set = memory.sets.find((item) => item.id === id)!;
    Object.assign(set, { reviewId, status: "review_required" });
    return getClientChangeSet(id);
  }
  await db.transaction(async (tx) => {
    await tx.insert(reviews).values({
      id: reviewId,
      organizationId: MTI_ORGANIZATION_ID,
      projectId: current.projectId,
      subjectType: "client_change_set",
      subjectId: id,
      reason: current.reason
    });
    await tx.update(clientChangeSets).set({
      reviewId,
      status: "review_required",
      updatedAt: new Date()
    }).where(and(
      eq(clientChangeSets.id, id),
      eq(clientChangeSets.organizationId, MTI_ORGANIZATION_ID)
    ));
  });
  return getClientChangeSet(id);
}

export async function decideClientChangeSet(input: {
  changeSetId: string;
  decision: "approved" | "rejected" | "changes_requested" | "needs_research";
  selectedItemIds?: string[];
  note?: string;
  userId?: string;
}) {
  const current = await getClientChangeSet(input.changeSetId);
  if (!current?.reviewId) throw new Error("Submitted change set not found.");
  if (current.status !== "review_required") throw new Error("Change set is not awaiting review.");
  if (new Date(current.expiresAt) <= new Date()) throw new Error("Change set expired.");
  const selected = input.decision === "approved"
    ? [...new Set(input.selectedItemIds?.length ? input.selectedItemIds : current.items.map((item) => item.id))]
    : [];
  if (selected.some((id) => !current.items.some((item) => item.id === id))) {
    throw new Error("Approval selection contains an unknown item.");
  }
  const proposalHash = current.contentHash;
  const decisionId = randomUUID();
  const userId = input.userId ?? MTI_OPERATOR_ID;
  if (input.decision !== "approved") {
    await persistNonApprovalDecision(current, {
      id: decisionId, decision: input.decision, note: input.note ?? "", userId, proposalHash
    });
    return { changeSet: await getClientChangeSet(input.changeSetId), approvalToken: null };
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const approvalId = randomUUID();
  const expiresAt = new Date(Math.min(
    new Date(current.expiresAt).getTime(),
    Date.now() + 15 * 60 * 1000
  ));
  if (!db) {
    memory.decisions.push({
      id: decisionId,
      reviewId: current.reviewId,
      userId,
      decision: "approved",
      note: input.note ?? "",
      selectedItemIds: selected,
      proposalHash
    });
    memory.approvals.push({
      id: approvalId,
      changeSetId: current.id,
      reviewDecisionId: decisionId,
      tokenHash,
      proposalHash,
      selectedItemIds: selected,
      expiresAt: expiresAt.toISOString(),
      consumedAt: null,
      invalidatedAt: null
    });
    const set = memory.sets.find((item) => item.id === current.id)!;
    Object.assign(set, {
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: userId
    });
    for (const item of memory.items.filter((item) => item.changeSetId === current.id)) {
      item.status = selected.includes(item.id) ? "approved" : "rejected";
      item.decisionNote = input.note ?? "";
    }
    const review = memory.reviews.find((item) => item.id === current.reviewId);
    if (review) review.status = "approved";
  } else {
    await db.transaction(async (tx) => {
      const [decision] = await tx.insert(reviewDecisions).values({
        id: decisionId,
        organizationId: MTI_ORGANIZATION_ID,
        reviewId: current.reviewId!,
        userId,
        decision: "approved",
        note: input.note ?? "",
        selectedItemIds: selected,
        proposalHash
      }).returning();
      await tx.insert(clientChangeApprovals).values({
        id: approvalId,
        organizationId: MTI_ORGANIZATION_ID,
        changeSetId: current.id,
        reviewDecisionId: decision.id,
        tokenHash,
        proposalHash,
        selectedItemIds: selected,
        expiresAt
      });
      await tx.update(clientChangeSets).set({
        status: "approved",
        approvedAt: new Date(),
        approvedBy: userId,
        updatedAt: new Date()
      }).where(eq(clientChangeSets.id, current.id));
      await tx.update(reviews).set({ status: "approved", updatedAt: new Date() })
        .where(eq(reviews.id, current.reviewId!));
      await tx.update(clientChangeItems).set({
        status: "rejected",
        decisionNote: input.note ?? "",
        updatedAt: new Date()
      }).where(eq(clientChangeItems.changeSetId, current.id));
      await tx.update(clientChangeItems).set({
        status: "approved",
        decisionNote: input.note ?? "",
        updatedAt: new Date()
      }).where(and(
        eq(clientChangeItems.changeSetId, current.id),
        inArray(clientChangeItems.id, selected)
      ));
    });
  }
  return { changeSet: await getClientChangeSet(current.id), approvalToken: token };
}

async function persistNonApprovalDecision(
  current: Awaited<ReturnType<typeof getClientChangeSet>> & {},
  decision: {
    id: string;
    decision: "rejected" | "changes_requested" | "needs_research";
    note: string;
    userId: string;
    proposalHash: string;
  }
) {
  const reviewStatus = decision.decision === "rejected" ? "rejected" : "revision";
  if (!db) {
    memory.decisions.push({
      ...decision,
      reviewId: current.reviewId,
      selectedItemIds: []
    });
    const set = memory.sets.find((item) => item.id === current.id)!;
    set.status = decision.decision;
    const review = memory.reviews.find((item) => item.id === current.reviewId);
    if (review) review.status = reviewStatus;
    return;
  }
  await db.transaction(async (tx) => {
    await tx.insert(reviewDecisions).values({
      id: decision.id,
      organizationId: MTI_ORGANIZATION_ID,
      reviewId: current.reviewId!,
      userId: decision.userId,
      decision: decision.decision,
      note: decision.note,
      proposalHash: decision.proposalHash
    });
    await tx.update(clientChangeSets).set({
      status: decision.decision,
      updatedAt: new Date()
    }).where(eq(clientChangeSets.id, current.id));
    await tx.update(reviews).set({ status: reviewStatus, updatedAt: new Date() })
      .where(eq(reviews.id, current.reviewId!));
  });
}

export async function reviseClientChangeItem(input: {
  changeSetId: string;
  itemId: string;
  after: Record<string, string> | null;
  note?: string;
}) {
  const current = await getClientChangeSet(input.changeSetId);
  if (!current) return null;
  if (["applied", "rolled_back"].includes(current.status)) throw new Error("Applied change sets cannot be edited.");
  const item = current.items.find((candidate) => candidate.id === input.itemId);
  if (!item) throw new Error("Change item not found.");
  const changed = changedFields(item.before, input.after);
  if (!db) {
    const stored = memory.items.find((candidate) => candidate.id === item.id)!;
    Object.assign(stored, {
      after: input.after,
      changedFields: changed,
      status: "pending",
      decisionNote: input.note ?? null
    });
    await invalidateMemoryApproval(current.id);
    refreshMemoryHash(current.id);
    return getClientChangeSet(current.id);
  }
  await db.transaction(async (tx) => {
    await tx.update(clientChangeItems).set({
      after: input.after,
      changedFields: changed,
      status: "pending",
      decisionNote: input.note ?? null,
      updatedAt: new Date()
    }).where(and(
      eq(clientChangeItems.id, item.id),
      eq(clientChangeItems.changeSetId, current.id)
    ));
    const rows = await tx.select().from(clientChangeItems)
      .where(eq(clientChangeItems.changeSetId, current.id));
    const contentHash = hashProposal(rows.map(itemFromRow));
    await tx.update(clientChangeApprovals).set({ invalidatedAt: new Date() })
      .where(eq(clientChangeApprovals.changeSetId, current.id));
    await tx.update(clientChangeSets).set({
      contentHash,
      revision: current.revision + 1,
      status: "draft",
      approvedAt: null,
      approvedBy: null,
      updatedAt: new Date()
    }).where(eq(clientChangeSets.id, current.id));
    if (current.reviewId) {
      await tx.update(reviews).set({ status: "revision", updatedAt: new Date() })
        .where(eq(reviews.id, current.reviewId));
    }
  });
  return getClientChangeSet(current.id);
}

export async function applyClientChangeSet(changeSetId: string, token: string) {
  const current = await getClientChangeSet(changeSetId);
  if (!current) throw new Error("Change set not found.");
  if (!db) return applyMemory(current, token);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${changeSetId}))`);
    const [set] = await tx.select().from(clientChangeSets).where(and(
      eq(clientChangeSets.id, changeSetId),
      eq(clientChangeSets.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
    if (!set || set.status === "applied") {
      const [existing] = await tx.select().from(clientChangeApplications)
        .where(eq(clientChangeApplications.changeSetId, changeSetId)).limit(1);
      if (existing?.status === "applied") return existing;
      throw new Error("Change set is not approved.");
    }
    const [approval] = await tx.select().from(clientChangeApprovals).where(and(
      eq(clientChangeApprovals.changeSetId, changeSetId),
      eq(clientChangeApprovals.tokenHash, hashToken(token))
    )).limit(1);
    validateApproval(set, approval);
    const items = await tx.select().from(clientChangeItems).where(and(
      eq(clientChangeItems.changeSetId, changeSetId),
      inArray(clientChangeItems.id, approval.selectedItemIds)
    ));
    const conflicts: string[] = [];
    for (const item of items) {
      const currentRecord = item.operation === "insert" ? null :
        (await tx.select().from(clientRecords).where(and(
          eq(clientRecords.id, item.recordId!),
          eq(clientRecords.databaseId, set.databaseId)
        )).limit(1))[0] ?? null;
      if (!same(currentRecord?.data as Record<string, string> | undefined ?? null, item.before)) {
        conflicts.push(item.id);
      }
      if (item.operation === "merge") {
        const merge = (await tx.select().from(clientRecords).where(and(
          eq(clientRecords.id, item.mergeRecordId!),
          eq(clientRecords.databaseId, set.databaseId)
        )).limit(1))[0] ?? null;
        if (!same(merge?.data as Record<string, string> | undefined ?? null, item.mergeBefore)) {
          conflicts.push(item.id);
        }
      }
    }
    if (conflicts.length > 0) {
      const [application] = await tx.insert(clientChangeApplications).values({
        organizationId: MTI_ORGANIZATION_ID,
        changeSetId,
        approvalId: approval.id,
        status: "conflict",
        conflictItemIds: [...new Set(conflicts)]
      }).onConflictDoUpdate({
        target: clientChangeApplications.changeSetId,
        set: { status: "conflict", conflictItemIds: [...new Set(conflicts)], updatedAt: new Date() }
      }).returning();
      await tx.update(clientChangeSets).set({ status: "conflict", updatedAt: new Date() })
        .where(eq(clientChangeSets.id, changeSetId));
      return application;
    }
    const applicationId = randomUUID();
    const appliedIds: string[] = [];
    await tx.insert(clientChangeApplications).values({
      id: applicationId,
      organizationId: MTI_ORGANIZATION_ID,
      changeSetId,
      approvalId: approval.id,
      status: "applying"
    });
    for (const item of items.sort((a, b) => a.position - b.position)) {
      if (item.operation === "insert") {
        await tx.insert(clientRecords).values({
          id: item.recordId!,
          databaseId: set.databaseId,
          data: item.after!,
          fingerprint: hashData(item.after!)
        });
        await tx.insert(clientChangeSnapshots).values({
          applicationId,
          itemId: item.id,
          recordId: item.recordId!,
          operation: "insert",
          before: null,
          after: item.after
        });
      } else if (item.operation === "update") {
        await tx.update(clientRecords).set({
          data: item.after!,
          fingerprint: hashData(item.after!),
          updatedAt: new Date()
        }).where(eq(clientRecords.id, item.recordId!));
        await tx.insert(clientChangeSnapshots).values({
          applicationId,
          itemId: item.id,
          recordId: item.recordId!,
          operation: "update",
          before: item.before,
          after: item.after
        });
      } else if (item.operation === "delete") {
        await tx.delete(clientRecords).where(eq(clientRecords.id, item.recordId!));
        await tx.insert(clientChangeSnapshots).values({
          applicationId,
          itemId: item.id,
          recordId: item.recordId!,
          operation: "delete",
          before: item.before,
          after: null
        });
      } else {
        await tx.update(clientRecords).set({
          data: item.after!,
          fingerprint: hashData(item.after!),
          updatedAt: new Date()
        }).where(eq(clientRecords.id, item.recordId!));
        await tx.delete(clientRecords).where(eq(clientRecords.id, item.mergeRecordId!));
        await tx.insert(clientChangeSnapshots).values([
          {
            applicationId, itemId: item.id, recordId: item.recordId!,
            operation: "update", before: item.before, after: item.after
          },
          {
            applicationId, itemId: item.id, recordId: item.mergeRecordId!,
            operation: "delete", before: item.mergeBefore, after: null
          }
        ]);
      }
      appliedIds.push(item.id);
    }
    const [application] = await tx.update(clientChangeApplications).set({
      status: "applied",
      appliedItemIds: appliedIds,
      appliedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(clientChangeApplications.id, applicationId)).returning();
    await tx.update(clientChangeApprovals).set({ consumedAt: new Date() })
      .where(eq(clientChangeApprovals.id, approval.id));
    await tx.update(clientChangeSets).set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(clientChangeSets.id, changeSetId));
    await tx.update(clientChangeItems).set({ status: "applied", updatedAt: new Date() })
      .where(inArray(clientChangeItems.id, appliedIds));
    return application;
  });
}

async function applyMemory(current: NonNullable<Awaited<ReturnType<typeof getClientChangeSet>>>, token: string) {
  const existing = memory.applications.find((item) =>
    item.changeSetId === current.id && item.status === "applied"
  );
  if (existing) return existing;
  const approval = memory.approvals.find((item) =>
    item.changeSetId === current.id && item.tokenHash === hashToken(token)
  );
  validateApproval(current, approval as Parameters<typeof validateApproval>[1]);
  const selected = current.items.filter((item) =>
    (approval!.selectedItemIds as string[]).includes(item.id)
  ) as MemoryItem[];
  const conflicts: string[] = [];
  for (const item of selected) {
    const record = item.operation === "insert" ? null :
      await repository.getRecord(current.databaseId, item.recordId!);
    if (!same(record?.data ?? null, item.before)) conflicts.push(item.id);
    if (item.operation === "merge") {
      const merge = await repository.getRecord(current.databaseId, item.mergeRecordId!);
      if (!same(merge?.data ?? null, item.mergeBefore)) conflicts.push(item.id);
    }
  }
  const application = {
    id: randomUUID(),
    changeSetId: current.id,
    approvalId: approval!.id,
    status: conflicts.length ? "conflict" : "applied",
    appliedItemIds: conflicts.length ? [] : selected.map((item) => item.id),
    conflictItemIds: [...new Set(conflicts)],
    appliedAt: conflicts.length ? null : new Date().toISOString(),
    rolledBackAt: null
  };
  memory.applications.push(application);
  if (conflicts.length) {
    memory.sets.find((item) => item.id === current.id)!.status = "conflict";
    return application;
  }
  for (const item of selected) {
    if (item.operation === "insert") {
      await repository.putRecord(current.databaseId, item.recordId!, item.after!);
      addMemorySnapshot(application.id, item, item.recordId!, "insert", null, item.after);
    } else if (item.operation === "update") {
      await repository.putRecord(current.databaseId, item.recordId!, item.after!);
      addMemorySnapshot(application.id, item, item.recordId!, "update", item.before, item.after);
    } else if (item.operation === "delete") {
      await repository.deleteRecordScoped(current.databaseId, item.recordId!);
      addMemorySnapshot(application.id, item, item.recordId!, "delete", item.before, null);
    } else {
      await repository.putRecord(current.databaseId, item.recordId!, item.after!);
      await repository.deleteRecordScoped(current.databaseId, item.mergeRecordId!);
      addMemorySnapshot(application.id, item, item.recordId!, "update", item.before, item.after);
      addMemorySnapshot(application.id, item, item.mergeRecordId!, "delete", item.mergeBefore, null);
    }
    memory.items.find((stored) => stored.id === item.id)!.status = "applied";
  }
  Object.assign(approval!, { consumedAt: new Date().toISOString() });
  Object.assign(memory.sets.find((item) => item.id === current.id)!, {
    status: "applied",
    appliedAt: new Date().toISOString()
  });
  return application;
}

export async function rollbackClientChangeSet(changeSetId: string) {
  if (!db) {
    const application = memory.applications.find((item) =>
      item.changeSetId === changeSetId && item.status === "applied"
    );
    if (!application) throw new Error("Applied change set not found.");
    const set = memory.sets.find((item) => item.id === changeSetId)!;
    const snapshots = memory.snapshots.filter((item) => item.applicationId === application.id).reverse();
    for (const snapshot of snapshots) {
      const current = await repository.getRecord(set.databaseId, snapshot.recordId as string);
      if (!same(current?.data ?? null, snapshot.after as Record<string, string> | null)) {
        throw new Error("Rollback conflict: client record changed after application.");
      }
    }
    for (const snapshot of snapshots) {
      if (snapshot.before) {
        await repository.putRecord(set.databaseId, snapshot.recordId as string, snapshot.before as Record<string, string>);
      } else {
        await repository.deleteRecordScoped(set.databaseId, snapshot.recordId as string);
      }
      snapshot.rolledBackAt = new Date().toISOString();
    }
    Object.assign(application, { status: "rolled_back", rolledBackAt: new Date().toISOString() });
    Object.assign(set, { status: "rolled_back", rolledBackAt: new Date().toISOString() });
    return application;
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${changeSetId}))`);
    const [set] = await tx.select().from(clientChangeSets).where(and(
      eq(clientChangeSets.id, changeSetId),
      eq(clientChangeSets.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
    const [application] = await tx.select().from(clientChangeApplications).where(and(
      eq(clientChangeApplications.changeSetId, changeSetId),
      eq(clientChangeApplications.status, "applied")
    )).limit(1);
    if (!set || !application) throw new Error("Applied change set not found.");
    const snapshots = await tx.select().from(clientChangeSnapshots)
      .where(eq(clientChangeSnapshots.applicationId, application.id));
    for (const snapshot of snapshots) {
      const [record] = await tx.select().from(clientRecords).where(and(
        eq(clientRecords.id, snapshot.recordId),
        eq(clientRecords.databaseId, set.databaseId)
      )).limit(1);
      if (!same(record?.data as Record<string, string> | undefined ?? null, snapshot.after)) {
        throw new Error("Rollback conflict: client record changed after application.");
      }
    }
    for (const snapshot of [...snapshots].reverse()) {
      if (snapshot.before) {
        await tx.insert(clientRecords).values({
          id: snapshot.recordId,
          databaseId: set.databaseId,
          data: snapshot.before,
          fingerprint: hashData(snapshot.before)
        }).onConflictDoUpdate({
          target: clientRecords.id,
          set: {
            data: snapshot.before,
            fingerprint: hashData(snapshot.before),
            updatedAt: new Date()
          }
        });
      } else {
        await tx.delete(clientRecords).where(eq(clientRecords.id, snapshot.recordId));
      }
    }
    const now = new Date();
    await tx.update(clientChangeSnapshots).set({ rolledBackAt: now })
      .where(eq(clientChangeSnapshots.applicationId, application.id));
    const [rolledBack] = await tx.update(clientChangeApplications).set({
      status: "rolled_back", rolledBackAt: now, updatedAt: now
    }).where(eq(clientChangeApplications.id, application.id)).returning();
    await tx.update(clientChangeSets).set({
      status: "rolled_back", rolledBackAt: now, updatedAt: now
    }).where(eq(clientChangeSets.id, changeSetId));
    return rolledBack;
  });
}

export async function getClientChangeSet(id: string) {
  if (!db) {
    const set = memory.sets.find((item) => item.id === id);
    return set ? detail(set, memory.items.filter((item) => item.changeSetId === id)) : null;
  }
  const [set] = await db.select().from(clientChangeSets).where(and(
    eq(clientChangeSets.id, id),
    eq(clientChangeSets.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  if (!set) return null;
  const items = await db.select().from(clientChangeItems)
    .where(eq(clientChangeItems.changeSetId, id));
  return { ...set, items };
}

export async function listProjectClientChangeSets(projectId: string) {
  if (!db) {
    return memory.sets.filter((set) => set.projectId === projectId)
      .map((set) => detail(set, memory.items.filter((item) => item.changeSetId === set.id)));
  }
  const sets = await db.select().from(clientChangeSets).where(and(
    eq(clientChangeSets.organizationId, MTI_ORGANIZATION_ID),
    eq(clientChangeSets.projectId, projectId)
  ));
  return Promise.all(sets.map((set) => getClientChangeSet(set.id)));
}

async function findByIdempotency(key: string) {
  if (!db) {
    const set = memory.sets.find((item) => item.idempotencyKey === key);
    return set ? detail(set, memory.items.filter((item) => item.changeSetId === set.id)) : null;
  }
  const [set] = await db.select().from(clientChangeSets).where(and(
    eq(clientChangeSets.organizationId, MTI_ORGANIZATION_ID),
    eq(clientChangeSets.idempotencyKey, key)
  )).limit(1);
  return set ? getClientChangeSet(set.id) : null;
}

function validateApproval(
  set: { status: string; contentHash: string; expiresAt: string | Date },
  approval: {
    proposalHash: string;
    expiresAt: string | Date;
    consumedAt?: string | Date | null;
    invalidatedAt?: string | Date | null;
  } | undefined
) {
  if (!approval) throw new Error("Approval token is invalid.");
  if (set.status !== "approved") throw new Error("Change set is not approved.");
  if (approval.consumedAt) throw new Error("Approval token was already consumed.");
  if (approval.invalidatedAt) throw new Error("Approval token was invalidated.");
  if (new Date(approval.expiresAt) <= new Date() || new Date(set.expiresAt) <= new Date()) {
    throw new Error("Approval token expired.");
  }
  if (approval.proposalHash !== set.contentHash) throw new Error("Approval no longer matches proposal.");
}

function changedFields(
  before: Record<string, string> | null,
  after: Record<string, string> | null
) {
  return [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((key) => before?.[key] !== after?.[key])
    .sort();
}
function hashProposal(items: Array<Pick<MemoryItem, "id" | "operation" | "recordId" | "mergeRecordId" | "before" | "mergeBefore" | "after" | "sourceEvidenceIds" | "confidence">>) {
  return createHash("sha256").update(stable(items
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      operation: item.operation,
      recordId: item.recordId,
      mergeRecordId: item.mergeRecordId ?? null,
      before: item.before,
      mergeBefore: item.mergeBefore,
      after: item.after,
      sourceEvidenceIds: item.sourceEvidenceIds ?? [],
      confidence: item.confidence ?? 0
    })))).digest("hex");
}
function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function hashData(value: Record<string, string>) {
  return createHash("sha256").update(stable(value)).digest("hex");
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function same(left: Record<string, string> | null, right: Record<string, string> | null) {
  return stable(left) === stable(right);
}
function detail(set: MemorySet, items: MemoryItem[]) {
  return { ...set, items: items.slice().sort((a, b) => a.position - b.position) };
}
function itemFromRow(row: typeof clientChangeItems.$inferSelect): MemoryItem {
  return {
    id: row.id,
    changeSetId: row.changeSetId,
    operation: row.operation as ClientChangeOperation,
    recordId: row.recordId!,
    mergeRecordId: row.mergeRecordId,
    before: row.before,
    mergeBefore: row.mergeBefore,
    after: row.after,
    changedFields: row.changedFields,
    sourceEvidenceIds: row.sourceEvidenceIds,
    confidence: row.confidence,
    validationWarnings: row.validationWarnings,
    duplicateRecordIds: row.duplicateRecordIds,
    status: row.status,
    decisionNote: row.decisionNote,
    position: row.position
  };
}
function addMemorySnapshot(
  applicationId: string,
  item: MemoryItem,
  recordId: string,
  operation: string,
  before: Record<string, string> | null,
  after: Record<string, string> | null
) {
  memory.snapshots.push({
    id: randomUUID(), applicationId, itemId: item.id, recordId,
    operation, before, after, rolledBackAt: null
  });
}
async function invalidateMemoryApproval(changeSetId: string) {
  for (const approval of memory.approvals.filter((item) => item.changeSetId === changeSetId)) {
    approval.invalidatedAt = new Date().toISOString();
  }
  const set = memory.sets.find((item) => item.id === changeSetId)!;
  Object.assign(set, {
    status: "draft",
    revision: set.revision + 1,
    approvedAt: null,
    approvedBy: null
  });
}
function refreshMemoryHash(changeSetId: string) {
  const set = memory.sets.find((item) => item.id === changeSetId)!;
  set.contentHash = hashProposal(memory.items.filter((item) => item.changeSetId === changeSetId));
}

export function getClientChangeTestState() {
  return memory;
}
