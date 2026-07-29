import { beforeEach, describe, expect, it } from "vitest";
import {
  applyClientChangeSet,
  createClientChangeSet,
  decideClientChangeSet,
  getClientChangeTestState,
  reviseClientChangeItem,
  rollbackClientChangeSet,
  submitClientChangeSet
} from "@/lib/client-changes";
import { repository } from "@/lib/repository";
import { POST as directCreate } from "@/app/api/v1/client-databases/[databaseId]/records/route";
import { DELETE as directDelete } from "@/app/api/v1/client-databases/[databaseId]/records/[recordId]/route";

async function fixture() {
  const project = await repository.createProject({
    name: `Client change test ${crypto.randomUUID()}`,
    objective: "Verify governed database writes.",
    context: "",
    scope: "",
    constraints: [],
    budgetCents: 1000
  });
  const database = await repository.createClientDatabase({
    name: `Companies ${crypto.randomUUID()}`,
    description: ""
  });
  const [existing] = await repository.createRecords(database.id, [{
    company: "Existing Company",
    status: "prospect"
  }]);
  return { project, database, existing };
}

describe("governed client-data changes", () => {
  beforeEach(() => {
    const state = getClientChangeTestState();
    for (const value of Object.values(state)) value.splice(0);
  });

  it("creates idempotent proposals and applies only explicitly selected items", async () => {
    const { project, database, existing } = await fixture();
    const idempotencyKey = `proposal-${crypto.randomUUID()}`;
    const proposal = await createClientChangeSet({
      projectId: project.id,
      databaseId: database.id,
      title: "Approved company updates",
      idempotencyKey,
      items: [
        {
          operation: "update",
          recordId: existing.id,
          after: { company: "Existing Company", status: "qualified" }
        },
        {
          operation: "insert",
          after: { company: "New Company", status: "prospect" }
        }
      ]
    });
    const repeated = await createClientChangeSet({
      projectId: project.id,
      databaseId: database.id,
      title: "Ignored duplicate request",
      idempotencyKey,
      items: [{ operation: "insert", after: { company: "Duplicate" } }]
    });
    expect(repeated.id).toBe(proposal.id);
    expect(proposal.items[0].before).toEqual(existing.data);

    await submitClientChangeSet(proposal.id);
    const decision = await decideClientChangeSet({
      changeSetId: proposal.id,
      decision: "approved",
      selectedItemIds: [proposal.items[0].id]
    });
    expect(decision.approvalToken).toBeTruthy();
    const applied = await applyClientChangeSet(proposal.id, decision.approvalToken!);
    expect(applied.status).toBe("applied");
    expect((await repository.getRecord(database.id, existing.id))?.data.status).toBe("qualified");
    expect(await repository.getRecord(database.id, proposal.items[1].recordId!)).toBeNull();
  });

  it("invalidates approval when exact proposed values change", async () => {
    const { project, database, existing } = await fixture();
    const proposal = await createClientChangeSet({
      projectId: project.id,
      databaseId: database.id,
      title: "Editable update",
      idempotencyKey: `edit-${crypto.randomUUID()}`,
      items: [{
        operation: "update",
        recordId: existing.id,
        after: { ...existing.data, status: "qualified" }
      }]
    });
    await submitClientChangeSet(proposal.id);
    const decision = await decideClientChangeSet({
      changeSetId: proposal.id,
      decision: "approved"
    });
    await reviseClientChangeItem({
      changeSetId: proposal.id,
      itemId: proposal.items[0].id,
      after: { ...existing.data, status: "customer" }
    });
    await expect(applyClientChangeSet(proposal.id, decision.approvalToken!))
      .rejects.toThrow(/approval|approved|invalid/i);
    expect((await repository.getRecord(database.id, existing.id))?.data.status).toBe("prospect");
  });

  it("detects concurrent changes before any proposal item is written", async () => {
    const { project, database, existing } = await fixture();
    const proposal = await createClientChangeSet({
      projectId: project.id,
      databaseId: database.id,
      title: "Conflict-safe batch",
      idempotencyKey: `conflict-${crypto.randomUUID()}`,
      items: [
        {
          operation: "update",
          recordId: existing.id,
          after: { ...existing.data, status: "qualified" }
        },
        { operation: "insert", after: { company: "Must not be inserted" } }
      ]
    });
    await submitClientChangeSet(proposal.id);
    const decision = await decideClientChangeSet({ changeSetId: proposal.id, decision: "approved" });
    await repository.putRecord(database.id, existing.id, { ...existing.data, status: "externally changed" });
    const application = await applyClientChangeSet(proposal.id, decision.approvalToken!);
    expect(application.status).toBe("conflict");
    expect(await repository.getRecord(database.id, proposal.items[1].recordId!)).toBeNull();
  });

  it("restores exact snapshots on rollback", async () => {
    const { project, database, existing } = await fixture();
    const proposal = await createClientChangeSet({
      projectId: project.id,
      databaseId: database.id,
      title: "Reversible batch",
      idempotencyKey: `rollback-${crypto.randomUUID()}`,
      items: [
        {
          operation: "update",
          recordId: existing.id,
          after: { ...existing.data, status: "qualified" }
        },
        { operation: "insert", after: { company: "Temporary Company" } }
      ]
    });
    await submitClientChangeSet(proposal.id);
    const decision = await decideClientChangeSet({ changeSetId: proposal.id, decision: "approved" });
    await applyClientChangeSet(proposal.id, decision.approvalToken!);
    await rollbackClientChangeSet(proposal.id);
    expect((await repository.getRecord(database.id, existing.id))?.data).toEqual(existing.data);
    expect(await repository.getRecord(database.id, proposal.items[1].recordId!)).toBeNull();
  });

  it("blocks direct record creation and deletion routes", async () => {
    const response = await directCreate(new Request("http://local", { method: "POST" }), {
      params: Promise.resolve({ databaseId: crypto.randomUUID() })
    });
    const deleted = await directDelete(new Request("http://local", { method: "DELETE" }), {
      params: Promise.resolve({ recordId: crypto.randomUUID() })
    });
    expect(response.status).toBe(405);
    expect(deleted.status).toBe(405);
  });
});
