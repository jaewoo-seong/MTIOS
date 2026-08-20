import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  gmailConnections,
  gmailOauthStates
} from "@/lib/db/schema";
import { MTI_OPERATOR_ID, MTI_ORGANIZATION_ID } from "@/lib/repository";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send"
] as const;

// These identify the connected Google account. They do not grant access to
// Gmail messages, threads, attachments, labels, or drafts.
export const GOOGLE_IDENTITY_SCOPES = ["openid", "email"] as const;

type Fetcher = typeof fetch;
type MemoryState = {
  oauthStates: Array<Record<string, unknown>>;
  connections: Array<Record<string, unknown>>;
};
const globalGmail = globalThis as typeof globalThis & { __mtiGmail?: MemoryState };
const memory = globalGmail.__mtiGmail ??= {
  oauthStates: [], connections: []
};

export function encryptSecret(value: string, keyValue = process.env.GMAIL_TOKEN_ENCRYPTION_KEY) {
  const key = encryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string, keyValue = process.env.GMAIL_TOKEN_ENCRYPTION_KEY) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Encrypted token format is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyValue), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey(value?: string) {
  if (!value) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is not configured.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return decoded;
}

function googleConfig() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Gmail OAuth is not configured.");
  return { clientId, clientSecret };
}

export async function createGmailAuthorization(input: {
  redirectUri?: string;
  userId?: string;
}) {
  const { clientId } = googleConfig();
  encryptionKey(process.env.GMAIL_TOKEN_ENCRYPTION_KEY);
  const redirectUri = input.redirectUri ??
    `${process.env.APP_URL ?? "http://localhost:3000"}/api/v1/integrations/gmail/callback`;
  const state = randomBytes(32).toString("base64url");
  const stateHash = sha256(state);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const userId = input.userId ?? MTI_OPERATOR_ID;
  if (!db) {
    memory.oauthStates.push({
      id: randomUUID(), organizationId: MTI_ORGANIZATION_ID, userId,
      stateHash, redirectUri, expiresAt: expiresAt.toISOString(), consumedAt: null
    });
  } else {
    await db.insert(gmailOauthStates).values({
      organizationId: MTI_ORGANIZATION_ID,
      userId,
      stateHash,
      redirectUri,
      expiresAt
    });
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [...GOOGLE_IDENTITY_SCOPES, ...GMAIL_SCOPES].join(" "),
    access_type: "offline",
    prompt: "consent",
    state
  }).toString();
  return { url: url.toString(), expiresAt: expiresAt.toISOString() };
}

export async function completeGmailAuthorization(input: {
  code: string;
  state: string;
  fetcher?: Fetcher;
}) {
  const fetcher = input.fetcher ?? fetch;
  const oauth = await consumeOauthState(input.state);
  const { clientId, clientSecret } = googleConfig();
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: String(oauth.redirectUri),
      grant_type: "authorization_code"
    })
  });
  const tokens = await jsonResponse<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>(response, "Google token exchange failed.");
  if (!tokens.refresh_token) throw new Error("Google did not return offline access. Reconnect and grant consent.");
  assertRequiredScopes(tokens.scope?.split(" ") ?? []);
  const profileResponse = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  });
  const profile = await jsonResponse<{
    sub: string;
    email: string;
    email_verified?: boolean;
  }>(profileResponse, "Google account identity request failed.");
  if (!profile.sub || !profile.email || profile.email_verified === false) {
    throw new Error("Google did not return a verified sender identity.");
  }
  return upsertConnection({
    userId: String(oauth.userId),
    googleAccountId: profile.sub,
    email: profile.email,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    scopes: tokens.scope?.split(" ") ?? [...GMAIL_SCOPES]
  });
}

export async function listGmailConnections() {
  if (!db) return memory.connections.map(publicConnection);
  const rows = await db.select({
    id: gmailConnections.id,
    email: gmailConnections.email,
    scopes: gmailConnections.scopes,
    status: gmailConnections.status,
    isServiceSender: gmailConnections.isServiceSender,
    serviceSenderSetAt: gmailConnections.serviceSenderSetAt,
    lastSyncAt: gmailConnections.lastSyncAt,
    lastError: gmailConnections.lastError,
    createdAt: gmailConnections.createdAt,
    updatedAt: gmailConnections.updatedAt
  }).from(gmailConnections).where(eq(gmailConnections.organizationId, MTI_ORGANIZATION_ID));
  return rows;
}

export async function setGmailServiceSender(connectionId: string, actorId: string) {
  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw new Error("Active Gmail connection not found.");
  const scopes = Array.isArray(connection.scopes) ? connection.scopes.map(String) : [];
  if (!hasSendOnlyGmailAccess(scopes)) {
    throw new Error("Reconnect Gmail with send-only permission before selecting it for notifications.");
  }
  const now = new Date();
  if (!db) {
    for (const item of memory.connections) Object.assign(item, {
      isServiceSender: item.id === connectionId,
      serviceSenderSetBy: item.id === connectionId ? actorId : null,
      serviceSenderSetAt: item.id === connectionId ? now.toISOString() : null
    });
  } else {
    await db.transaction(async (tx) => {
      // Serialize service-sender changes per organization so two admin clicks
      // cannot leave two active senders after interleaved reset/set updates.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gmail-service-sender:${MTI_ORGANIZATION_ID}`}))`);
      await tx.update(gmailConnections).set({
        isServiceSender: false, serviceSenderSetBy: null, serviceSenderSetAt: null, updatedAt: now
      }).where(eq(gmailConnections.organizationId, MTI_ORGANIZATION_ID));
      const [selected] = await tx.update(gmailConnections).set({
        isServiceSender: true, serviceSenderSetBy: actorId, serviceSenderSetAt: now, updatedAt: now
      }).where(and(
        eq(gmailConnections.id, connectionId),
        eq(gmailConnections.organizationId, MTI_ORGANIZATION_ID),
        eq(gmailConnections.status, "active")
      )).returning({ id: gmailConnections.id });
      if (!selected) throw new Error("Active Gmail connection not found.");
    });
  }
  return { id: connectionId, isServiceSender: true };
}

export async function sendServiceEmail(input: {
  to: string;
  subject: string;
  bodyText: string;
  fetcher?: Fetcher;
}) {
  const connection = await getServiceSender();
  if (!connection) throw new Error("Gmail service sender is not configured.");
  const fetcher = input.fetcher ?? fetch;
  const token = await accessToken(String(connection.id), fetcher);
  const raw = encodeMessage({ to: [input.to], subject: input.subject, bodyText: input.bodyText });
  const result = await jsonResponse<{ id: string; threadId?: string }>(
    await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw })
    }),
    "Gmail notification send failed."
  );
  return {
    gmailMessageId: result.id,
    gmailThreadId: result.threadId ?? null,
    gmailConnectionId: String(connection.id),
    sender: String(connection.email)
  };
}

export async function disconnectGmail(connectionId: string, fetcher: Fetcher = fetch) {
  const connection = await getConnection(connectionId);
  if (!connection) throw new Error("Gmail connection not found.");
  const token = decryptSecret(String(connection.encryptedRefreshToken));
  await fetcher("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token })
  }).catch(() => null);
  if (!db) {
    const stored = memory.connections.find((item) => item.id === connectionId);
    if (stored) Object.assign(stored, { status: "revoked", encryptedRefreshToken: "", encryptedAccessToken: null });
  } else {
    await db.update(gmailConnections).set({
      status: "revoked",
      encryptedRefreshToken: "",
      encryptedAccessToken: null,
      updatedAt: new Date()
    }).where(and(
      eq(gmailConnections.id, connectionId),
      eq(gmailConnections.organizationId, MTI_ORGANIZATION_ID)
    ));
  }
  return { id: connectionId, status: "revoked" };
}

type EmailMessageInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
};

async function consumeOauthState(state: string) {
  const hash = sha256(state);
  if (!db) {
    const row = memory.oauthStates.find((item) => item.stateHash === hash);
    if (!row || row.consumedAt || new Date(String(row.expiresAt)) <= new Date()) {
      throw new Error("OAuth state is invalid or expired.");
    }
    row.consumedAt = new Date().toISOString();
    return row;
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(gmailOauthStates)
      .where(eq(gmailOauthStates.stateHash, hash)).limit(1);
    if (!row || row.organizationId !== MTI_ORGANIZATION_ID || row.consumedAt || row.expiresAt <= new Date()) {
      throw new Error("OAuth state is invalid or expired.");
    }
    await tx.update(gmailOauthStates).set({ consumedAt: new Date() })
      .where(eq(gmailOauthStates.id, row.id));
    return row;
  });
}

async function upsertConnection(input: {
  userId: string;
  googleAccountId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  scopes: string[];
}) {
  const values = {
    organizationId: MTI_ORGANIZATION_ID,
    userId: input.userId,
    googleAccountId: input.googleAccountId,
    email: input.email,
    encryptedRefreshToken: encryptSecret(input.refreshToken),
    encryptedAccessToken: encryptSecret(input.accessToken),
    accessTokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
    scopes: input.scopes,
    status: "active"
  };
  if (!db) {
    const existing = memory.connections.find((item) =>
      item.googleAccountId === input.googleAccountId ||
      String(item.email).toLowerCase() === input.email.toLowerCase()
    );
    if (existing) Object.assign(existing, values, { updatedAt: new Date().toISOString() });
    else memory.connections.push({ id: randomUUID(), ...values, isServiceSender: false, createdAt: new Date().toISOString() });
    return publicConnection(existing ?? memory.connections.at(-1)!);
  }
  const [existingByAccount] = await db.select({ id: gmailConnections.id })
    .from(gmailConnections)
    .where(and(
      eq(gmailConnections.organizationId, MTI_ORGANIZATION_ID),
      eq(gmailConnections.googleAccountId, input.googleAccountId)
    ))
    .limit(1);
  const [existingByEmail] = existingByAccount ? [] : await db.select({ id: gmailConnections.id })
    .from(gmailConnections)
    .where(and(
      eq(gmailConnections.organizationId, MTI_ORGANIZATION_ID),
      sql`lower(${gmailConnections.email}) = lower(${input.email})`
    ))
    .limit(1);
  const existing = existingByAccount ?? existingByEmail;
  if (existing) {
    const [row] = await db.update(gmailConnections).set({
      ...values,
      updatedAt: new Date(),
      lastError: null
    }).where(eq(gmailConnections.id, existing.id)).returning();
    return publicConnection(row);
  }
  const [row] = await db.insert(gmailConnections).values(values).onConflictDoUpdate({
    target: [gmailConnections.organizationId, gmailConnections.googleAccountId],
    set: { ...values, updatedAt: new Date(), lastError: null }
  }).returning();
  return publicConnection(row);
}

async function getConnection(id: string) {
  if (!db) return memory.connections.find((item) => item.id === id) ?? null;
  const [row] = await db.select().from(gmailConnections).where(and(
    eq(gmailConnections.id, id),
    eq(gmailConnections.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  return row ?? null;
}

async function getServiceSender() {
  if (!db) return memory.connections.find((item) =>
    item.isServiceSender === true && item.status === "active" &&
    hasSendOnlyGmailAccess(Array.isArray(item.scopes) ? item.scopes.map(String) : [])
  ) ?? null;
  const rows = await db.select().from(gmailConnections).where(and(
    eq(gmailConnections.organizationId, MTI_ORGANIZATION_ID),
    eq(gmailConnections.isServiceSender, true),
    eq(gmailConnections.status, "active")
  ));
  return rows.find((row) => hasSendOnlyGmailAccess(row.scopes)) ?? null;
}

function hasSendOnlyGmailAccess(scopes: string[]) {
  const gmailScopes = scopes.filter((scope) =>
    scope === "https://mail.google.com/" || scope.startsWith("https://www.googleapis.com/auth/gmail.")
  );
  return gmailScopes.length === 1 && gmailScopes[0] === GMAIL_SCOPES[0];
}

async function accessToken(connectionId: string, fetcher: Fetcher) {
  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw new Error("Active Gmail connection not found.");
  if (
    connection.encryptedAccessToken &&
    new Date(String(connection.accessTokenExpiresAt)).getTime() > Date.now() + 60_000
  ) return decryptSecret(String(connection.encryptedAccessToken));
  const { clientId, clientSecret } = googleConfig();
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptSecret(String(connection.encryptedRefreshToken)),
      grant_type: "refresh_token"
    })
  });
  const token = await jsonResponse<{ access_token: string; expires_in: number }>(response, "Gmail token refresh failed.");
  const encrypted = encryptSecret(token.access_token);
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  if (!db) Object.assign(connection, { encryptedAccessToken: encrypted, accessTokenExpiresAt: expiresAt.toISOString() });
  else await db.update(gmailConnections).set({
    encryptedAccessToken: encrypted,
    accessTokenExpiresAt: expiresAt,
    lastError: null,
    updatedAt: new Date()
  }).where(eq(gmailConnections.id, connectionId));
  return token.access_token;
}

function encodeMessage(input: EmailMessageInput) {
  for (const value of [...input.to, ...(input.cc ?? []), ...(input.bcc ?? []), input.subject]) {
    if (/[\r\n]/.test(value)) throw new Error("Email headers cannot contain line breaks.");
  }
  const lines = [
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${input.bcc.join(", ")}`] : []),
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.bodyText
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

function publicConnection(connection: Record<string, unknown>) {
  const {
    encryptedRefreshToken: _refresh,
    encryptedAccessToken: _access,
    ...safe
  } = connection;
  return safe;
}

function assertRequiredScopes(scopes: string[]) {
  const missing = GMAIL_SCOPES.filter((scope) => !scopes.includes(scope));
  if (missing.length) throw new Error(`Google authorization omitted required scopes: ${missing.join(", ")}`);
  if (!hasSendOnlyGmailAccess(scopes)) {
    throw new Error("Google authorization returned mailbox scopes. Revoke the old grant and reconnect with send-only permission.");
  }
}

async function jsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } | string };
  if (!response.ok) {
    const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(detail || fallback);
  }
  return payload;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function getGmailTestState() {
  return memory;
}
