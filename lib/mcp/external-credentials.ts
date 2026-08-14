import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/client";
import {
  mcpExternalCredentialProjects,
  mcpExternalCredentials,
  memberships,
  projects,
  users
} from "@/lib/db/schema";
import { externalMcpScopes, type ExternalMcpScope } from "@/lib/mcp/external-contracts";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

const TOKEN_PREFIX = "mti_mcp";
const HASH_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export type ExternalMcpAccessMode = "selected_projects" | "organization";
export type ExternalMcpPrincipal = {
  credentialId: string;
  organizationId: string;
  createdByUserId: string;
  clientName: string;
  scopes: ExternalMcpScope[];
  accessMode: ExternalMcpAccessMode;
  allowedProjectIds: string[];
};

export class ExternalMcpAuthError extends Error {
  constructor(public code: "invalid_token" | "expired_token" | "revoked_token", public status = 401) {
    super(code);
  }
}

export function generateExternalMcpToken() {
  const publicPrefix = randomBytes(6).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  return { publicPrefix, token: `${TOKEN_PREFIX}_${publicPrefix}_${secret}` };
}

export function parseExternalMcpToken(value: string | null | undefined) {
  if (!value) return null;
  const match = /^mti_mcp_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{43})$/.exec(value);
  return match ? { publicPrefix: match[1], token: value } : null;
}

export function bearerToken(authorization: string | null | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice(7).trim();
}

export async function hashExternalMcpToken(token: string) {
  return hash(token, HASH_OPTIONS);
}

export async function verifyExternalMcpToken(token: string, encoded: string) {
  return verify(encoded, token);
}

export function requestHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function validateExternalMcpScopes(scopes: readonly string[]): ExternalMcpScope[] {
  const allowed = new Set<string>(externalMcpScopes);
  const unique = [...new Set(scopes)];
  if (unique.some((scope) => !allowed.has(scope))) throw new Error("Unknown external MCP scope.");
  return unique as ExternalMcpScope[];
}

export async function createExternalMcpCredential(input: {
  organizationId?: string;
  createdByUserId: string;
  label: string;
  clientName: string;
  scopes: string[];
  accessMode: ExternalMcpAccessMode;
  projectIds?: string[];
  expiresAt?: Date | null;
  rotatedFromId?: string | null;
}) {
  const database = requireDatabase();
  const organizationId = input.organizationId ?? MTI_ORGANIZATION_ID;
  const scopes = validateExternalMcpScopes(input.scopes);
  const projectIds = [...new Set(input.projectIds ?? [])];
  if (input.accessMode === "selected_projects" && projectIds.length === 0) {
    throw new Error("Select at least one project or explicitly choose organization access.");
  }
  if (projectIds.length) {
    const permitted = await database.select({ id: projects.id }).from(projects).where(and(
      eq(projects.organizationId, organizationId), inArray(projects.id, projectIds)
    ));
    if (permitted.length !== projectIds.length) throw new Error("One or more projects are unavailable.");
  }
  const generated = generateExternalMcpToken();
  const secretHash = await hashExternalMcpToken(generated.token);
  const credential = await database.transaction(async (tx) => {
    const [row] = await tx.insert(mcpExternalCredentials).values({
      organizationId,
      createdByUserId: input.createdByUserId,
      label: input.label.trim(),
      clientName: input.clientName.trim(),
      publicPrefix: generated.publicPrefix,
      secretHash,
      scopes,
      accessMode: input.accessMode,
      expiresAt: input.expiresAt ?? null,
      rotatedFromId: input.rotatedFromId ?? null
    }).returning();
    if (projectIds.length) await tx.insert(mcpExternalCredentialProjects).values(
      projectIds.map((projectId) => ({ credentialId: row.id, projectId }))
    );
    return row;
  });
  return { credential: publicCredential(credential, projectIds), token: generated.token };
}

export async function listExternalMcpCredentials(organizationId = MTI_ORGANIZATION_ID) {
  const database = requireDatabase();
  const credentials = await database.select().from(mcpExternalCredentials)
    .where(eq(mcpExternalCredentials.organizationId, organizationId))
    .orderBy(desc(mcpExternalCredentials.createdAt));
  const links = credentials.length
    ? await database.select().from(mcpExternalCredentialProjects).where(inArray(
      mcpExternalCredentialProjects.credentialId,
      credentials.map((credential) => credential.id)
    ))
    : [];
  return credentials.map((credential) => publicCredential(
    credential,
    links.filter((link) => link.credentialId === credential.id).map((link) => link.projectId)
  ));
}

export async function revokeExternalMcpCredential(id: string, organizationId = MTI_ORGANIZATION_ID) {
  const database = requireDatabase();
  const [credential] = await database.update(mcpExternalCredentials).set({
    status: "revoked", revokedAt: new Date(), updatedAt: new Date()
  }).where(and(
    eq(mcpExternalCredentials.id, id),
    eq(mcpExternalCredentials.organizationId, organizationId),
    isNull(mcpExternalCredentials.revokedAt)
  )).returning();
  return credential ? publicCredential(credential, []) : null;
}

export async function rotateExternalMcpCredential(id: string, actorId: string, organizationId = MTI_ORGANIZATION_ID) {
  const database = requireDatabase();
  const generated = generateExternalMcpToken();
  const secretHash = await hashExternalMcpToken(generated.token);
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`external-mcp-rotation:${organizationId}:${id}`}))`);
    const [current] = await tx.select().from(mcpExternalCredentials).where(and(
      eq(mcpExternalCredentials.id, id), eq(mcpExternalCredentials.organizationId, organizationId)
    )).limit(1);
    if (!current || current.status !== "active" || current.revokedAt) return null;
    const projectRows = await tx.select({ projectId: mcpExternalCredentialProjects.projectId })
      .from(mcpExternalCredentialProjects).where(eq(mcpExternalCredentialProjects.credentialId, id));
    const [replacement] = await tx.insert(mcpExternalCredentials).values({
      organizationId,
      createdByUserId: actorId,
      label: current.label,
      clientName: current.clientName,
      publicPrefix: generated.publicPrefix,
      secretHash,
      scopes: current.scopes,
      accessMode: current.accessMode,
      expiresAt: current.expiresAt,
      rotatedFromId: current.id
    }).returning();
    if (projectRows.length) await tx.insert(mcpExternalCredentialProjects).values(
      projectRows.map(({ projectId }) => ({ credentialId: replacement.id, projectId }))
    );
    const now = new Date();
    await tx.update(mcpExternalCredentials).set({
      status: "rotated", rotatedAt: now, revokedAt: now, updatedAt: now
    }).where(and(
      eq(mcpExternalCredentials.id, current.id),
      eq(mcpExternalCredentials.organizationId, organizationId)
    ));
    return { credential: publicCredential(replacement, projectRows.map(({ projectId }) => projectId)), token: generated.token };
  });
}

export async function authenticateExternalMcpRequest(authorization: string | null | undefined): Promise<ExternalMcpPrincipal> {
  const parsed = parseExternalMcpToken(bearerToken(authorization));
  if (!parsed) throw new ExternalMcpAuthError("invalid_token");
  const database = requireDatabase();
  const [row] = await database.select({ credential: mcpExternalCredentials, userStatus: users.status })
    .from(mcpExternalCredentials)
    .innerJoin(users, eq(users.id, mcpExternalCredentials.createdByUserId))
    .innerJoin(memberships, and(
      eq(memberships.userId, users.id),
      eq(memberships.organizationId, mcpExternalCredentials.organizationId)
    ))
    .where(eq(mcpExternalCredentials.publicPrefix, parsed.publicPrefix)).limit(1);
  if (!row || !(await verifyExternalMcpToken(parsed.token, row.credential.secretHash)) || row.userStatus !== "active") {
    throw new ExternalMcpAuthError("invalid_token");
  }
  if (row.credential.status !== "active" || row.credential.revokedAt) throw new ExternalMcpAuthError("revoked_token");
  if (row.credential.expiresAt && row.credential.expiresAt <= new Date()) throw new ExternalMcpAuthError("expired_token");
  const projectRows = await database.select({ projectId: mcpExternalCredentialProjects.projectId })
    .from(mcpExternalCredentialProjects).where(eq(mcpExternalCredentialProjects.credentialId, row.credential.id));
  await database.update(mcpExternalCredentials).set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpExternalCredentials.id, row.credential.id));
  return {
    credentialId: row.credential.id,
    organizationId: row.credential.organizationId,
    createdByUserId: row.credential.createdByUserId,
    clientName: row.credential.clientName,
    scopes: validateExternalMcpScopes(row.credential.scopes),
    accessMode: row.credential.accessMode as ExternalMcpAccessMode,
    allowedProjectIds: projectRows.map((item) => item.projectId)
  };
}

function publicCredential(credential: typeof mcpExternalCredentials.$inferSelect, projectIds: string[]) {
  const { secretHash: _secretHash, ...safe } = credential;
  return { ...safe, projectIds };
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
