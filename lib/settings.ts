import { and, desc, eq, max } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modelRouteRevisions, userPreferences } from "@/lib/db/schema";
import { modelRoutePolicies, type ModelRoutePolicy } from "@/lib/ai/model-policy";
import type { ModelRoute } from "@/lib/ai/litellm";
import { MTI_OPERATOR_ID, MTI_ORGANIZATION_ID } from "@/lib/repository";

export type WorkspacePreferences = {
  locale: "en" | "ko";
  timezone: string;
  dateFormat: "short" | "medium" | "long";
  numberFormat: "locale";
  currency: "USD" | "KRW";
};

const defaultPreferences: WorkspacePreferences = {
  locale: "en",
  timezone: "America/Indiana/Indianapolis",
  dateFormat: "medium",
  numberFormat: "locale",
  currency: "USD"
};

type RouteRevision = {
  id: string;
  route: ModelRoute;
  version: number;
  configuration: ModelRoutePolicy;
  status: string;
  testStatus: string;
  testError: string | null;
  createdAt: string;
};

const state = globalThis as typeof globalThis & {
  __mtiPreferences?: WorkspacePreferences;
  __mtiModelRevisions?: RouteRevision[];
};
state.__mtiPreferences ??= defaultPreferences;
state.__mtiModelRevisions ??= [];

export async function getWorkspacePreferences(userId = MTI_OPERATOR_ID): Promise<WorkspacePreferences> {
  if (!db) return state.__mtiPreferences!;
  const [row] = await db.select().from(userPreferences).where(and(
    eq(userPreferences.organizationId, MTI_ORGANIZATION_ID),
    eq(userPreferences.userId, userId)
  )).limit(1);
  return row ? {
    locale: row.locale as WorkspacePreferences["locale"],
    timezone: row.timezone,
    dateFormat: row.dateFormat as WorkspacePreferences["dateFormat"],
    numberFormat: "locale",
    currency: row.currency as WorkspacePreferences["currency"]
  } : defaultPreferences;
}

export async function updateWorkspacePreferences(input: WorkspacePreferences, userId = MTI_OPERATOR_ID) {
  if (!db) {
    state.__mtiPreferences = input;
    return input;
  }
  const [row] = await db.insert(userPreferences).values({
    organizationId: MTI_ORGANIZATION_ID,
    userId,
    ...input
  }).onConflictDoUpdate({
    target: [userPreferences.organizationId, userPreferences.userId],
    set: { ...input, updatedAt: new Date() }
  }).returning();
  return {
    locale: row.locale,
    timezone: row.timezone,
    dateFormat: row.dateFormat,
    numberFormat: row.numberFormat,
    currency: row.currency
  };
}

export async function listModelRouteRevisions(route?: ModelRoute) {
  if (!db) {
    return state.__mtiModelRevisions!
      .filter((item) => !route || item.route === route)
      .sort((a, b) => b.version - a.version);
  }
  return db.select().from(modelRouteRevisions)
    .where(route
      ? and(eq(modelRouteRevisions.organizationId, MTI_ORGANIZATION_ID), eq(modelRouteRevisions.route, route))
      : eq(modelRouteRevisions.organizationId, MTI_ORGANIZATION_ID))
    .orderBy(desc(modelRouteRevisions.createdAt));
}

export async function createModelRouteRevision(route: ModelRoute, configuration: ModelRoutePolicy) {
  if (!db) {
    const version = Math.max(0, ...state.__mtiModelRevisions!
      .filter((item) => item.route === route).map((item) => item.version)) + 1;
    const row: RouteRevision = {
      id: crypto.randomUUID(), route, version, configuration,
      status: "draft", testStatus: "not_tested", testError: null,
      createdAt: new Date().toISOString()
    };
    state.__mtiModelRevisions!.push(row);
    return row;
  }
  return db.transaction(async (tx) => {
    const [latest] = await tx.select({ version: max(modelRouteRevisions.version) })
      .from(modelRouteRevisions).where(and(
        eq(modelRouteRevisions.organizationId, MTI_ORGANIZATION_ID),
        eq(modelRouteRevisions.route, route)
      ));
    const [row] = await tx.insert(modelRouteRevisions).values({
      organizationId: MTI_ORGANIZATION_ID,
      route,
      version: (latest.version ?? 0) + 1,
      configuration: { ...configuration, candidates: [...configuration.candidates] },
      createdBy: MTI_OPERATOR_ID
    }).returning();
    return row;
  });
}

export async function setModelRevisionState(
  id: string,
  action: "test_passed" | "test_failed" | "approve" | "activate" | "rollback",
  error?: string
) {
  const rows = await listModelRouteRevisions();
  const current = rows.find((item) => item.id === id);
  if (!current) throw new Error("Model route revision not found.");
  if (action === "approve" && current.testStatus !== "passed") {
    throw new Error("A successful test is required before approval.");
  }
  if (action === "activate" && current.status !== "approved") {
    throw new Error("Approval is required before activation.");
  }
  if (action === "rollback" && current.status !== "active") {
    throw new Error("Only the active revision can be rolled back.");
  }
  const values =
    action === "test_passed" ? { testStatus: "passed", testError: null } :
    action === "test_failed" ? { testStatus: "failed", testError: error ?? "Test failed." } :
    action === "approve" ? { status: "approved", approvedBy: MTI_OPERATOR_ID, approvedAt: new Date() } :
    action === "activate" ? { status: "active", activatedAt: new Date() } :
    { status: "rolled_back" };
  if (!db) {
    Object.assign(current, values);
    if (action === "activate") {
      for (const item of state.__mtiModelRevisions!) {
        if (item.route === current.route && item.id !== id && item.status === "active") item.status = "superseded";
      }
    } else if (action === "rollback") {
      const previous = state.__mtiModelRevisions!
        .filter((item) =>
          item.route === current.route &&
          item.id !== current.id &&
          item.version < current.version &&
          ["superseded", "approved"].includes(item.status)
        )
        .sort((a, b) => b.version - a.version)[0];
      if (previous) {
        previous.status = "active";
        Object.assign(previous, { activatedAt: new Date().toISOString() });
      }
    }
    return current;
  }
  return db.transaction(async (tx) => {
    if (action === "activate") {
      await tx.update(modelRouteRevisions).set({ status: "superseded", updatedAt: new Date() })
        .where(and(
          eq(modelRouteRevisions.organizationId, MTI_ORGANIZATION_ID),
          eq(modelRouteRevisions.route, current.route),
          eq(modelRouteRevisions.status, "active")
        ));
    }
    if (action === "rollback") {
      const candidate = (await tx.select().from(modelRouteRevisions).where(and(
        eq(modelRouteRevisions.organizationId, MTI_ORGANIZATION_ID),
        eq(modelRouteRevisions.route, current.route)
      )).orderBy(desc(modelRouteRevisions.version)))
        .find((item) =>
          item.id !== current.id &&
          item.version < current.version &&
          ["superseded", "approved"].includes(item.status)
        );
      if (candidate) {
        await tx.update(modelRouteRevisions).set({
          status: "active",
          activatedAt: new Date(),
          updatedAt: new Date()
        }).where(eq(modelRouteRevisions.id, candidate.id));
      }
    }
    const [row] = await tx.update(modelRouteRevisions).set({ ...values, updatedAt: new Date() })
      .where(and(eq(modelRouteRevisions.id, id), eq(modelRouteRevisions.organizationId, MTI_ORGANIZATION_ID)))
      .returning();
    return row;
  });
}

export async function getActiveModelPolicy(route: ModelRoute) {
  const revisions = await listModelRouteRevisions(route);
  const active = revisions.find((item) => item.status === "active");
  return active?.configuration ?? modelRoutePolicies[route];
}
