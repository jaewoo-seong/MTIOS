import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  gmailAttachments,
  gmailConnections,
  gmailDraftRevisions,
  gmailDrafts,
  gmailMessages,
  gmailOauthStates,
  gmailProjectLinks,
  gmailThreads,
  storageObjects
} from "@/lib/db/schema";
import { convertToMarkdown } from "@/lib/documents/convert";
import { MTI_OPERATOR_ID, MTI_ORGANIZATION_ID, repository } from "@/lib/repository";
import { storeBinaryObject } from "@/lib/storage";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose"
] as const;

type Fetcher = typeof fetch;
type MemoryState = {
  oauthStates: Array<Record<string, unknown>>;
  connections: Array<Record<string, unknown>>;
  threads: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  attachments: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  drafts: Array<Record<string, unknown>>;
  revisions: Array<Record<string, unknown>>;
};
const globalGmail = globalThis as typeof globalThis & { __mtiGmail?: MemoryState };
const memory = globalGmail.__mtiGmail ??= {
  oauthStates: [], connections: [], threads: [], messages: [],
  attachments: [], links: [], drafts: [], revisions: []
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
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
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
  const profileResponse = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  });
  const profile = await jsonResponse<{ emailAddress: string }>(profileResponse, "Gmail profile request failed.");
  return upsertConnection({
    userId: String(oauth.userId),
    googleAccountId: profile.emailAddress.toLowerCase(),
    email: profile.emailAddress,
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
    lastSyncAt: gmailConnections.lastSyncAt,
    lastError: gmailConnections.lastError,
    createdAt: gmailConnections.createdAt,
    updatedAt: gmailConnections.updatedAt
  }).from(gmailConnections).where(eq(gmailConnections.organizationId, MTI_ORGANIZATION_ID));
  return rows;
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

export async function searchGmailThreads(input: {
  connectionId: string;
  query: string;
  maxResults?: number;
  fetcher?: Fetcher;
}) {
  const fetcher = input.fetcher ?? fetch;
  const token = await accessToken(input.connectionId, fetcher);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
  url.searchParams.set("q", input.query);
  url.searchParams.set("maxResults", String(Math.min(input.maxResults ?? 25, 100)));
  const result = await jsonResponse<{ threads?: Array<{ id: string }> }>(
    await fetcher(url, { headers: { authorization: `Bearer ${token}` } }),
    "Gmail thread search failed."
  );
  const threads = [];
  for (const item of result.threads ?? []) {
    threads.push(await retrieveGmailThread({
      connectionId: input.connectionId,
      gmailThreadId: item.id,
      fetcher
    }));
  }
  return threads;
}

export async function retrieveGmailThread(input: {
  connectionId: string;
  gmailThreadId: string;
  fetcher?: Fetcher;
}) {
  const fetcher = input.fetcher ?? fetch;
  const token = await accessToken(input.connectionId, fetcher);
  const response = await fetcher(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(input.gmailThreadId)}?format=full`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const raw = await jsonResponse<GmailThreadPayload>(response, "Gmail thread retrieval failed.");
  return mirrorThread(input.connectionId, raw);
}

export async function summarizeGmailThread(input: {
  connectionId: string;
  gmailThreadId: string;
  fetcher?: Fetcher;
}) {
  const thread = await retrieveGmailThread(input) as Record<string, unknown> & {
    messages: Array<Record<string, unknown>>;
  };
  const messages = thread.messages;
  return {
    threadId: thread.id,
    gmailThreadId: thread.gmailThreadId,
    subject: thread.subject,
    participants: thread.participants,
    messageCount: messages.length,
    timeline: messages.map((message) => ({
      from: message.fromAddress,
      sentAt: message.sentAt,
      summary: String(message.snippet || message.bodyText || "").slice(0, 500)
    })),
    latest: messages.at(-1)?.snippet ?? "",
    generatedBy: "deterministic_email_digest"
  };
}

export async function linkGmailToProject(input: {
  projectId: string;
  threadId?: string | null;
  messageId?: string | null;
  clientRecordId?: string | null;
  companyId?: string | null;
}) {
  if (!input.threadId && !input.messageId) throw new Error("A Gmail thread or message is required.");
  if (!await repository.getProject(input.projectId)) throw new Error("Project not found.");
  const values = {
    id: randomUUID(),
    organizationId: MTI_ORGANIZATION_ID,
    projectId: input.projectId,
    threadId: input.threadId ?? null,
    messageId: input.messageId ?? null,
    clientRecordId: input.clientRecordId ?? null,
    companyId: input.companyId ?? null,
    linkedBy: MTI_OPERATOR_ID
  };
  if (!db) {
    const existing = memory.links.find((item) =>
      item.projectId === values.projectId &&
      item.threadId === values.threadId &&
      item.messageId === values.messageId
    );
    if (existing) return existing;
    memory.links.push(values);
    return values;
  }
  const [row] = await db.insert(gmailProjectLinks).values(values)
    .onConflictDoNothing().returning();
  if (row) return row;
  const [existing] = await db.select().from(gmailProjectLinks).where(and(
    eq(gmailProjectLinks.organizationId, MTI_ORGANIZATION_ID),
    eq(gmailProjectLinks.projectId, values.projectId),
    values.threadId
      ? eq(gmailProjectLinks.threadId, values.threadId)
      : eq(gmailProjectLinks.messageId, values.messageId!)
  )).limit(1);
  return existing;
}

export async function createGmailDraft(input: DraftInput & {
  connectionId: string;
  projectId: string;
  threadId?: string | null;
  fetcher?: Fetcher;
}) {
  if (!await repository.getProject(input.projectId)) throw new Error("Project not found.");
  const fetcher = input.fetcher ?? fetch;
  const token = await accessToken(input.connectionId, fetcher);
  const thread = input.threadId ? await getMirroredThread(input.threadId) : null;
  const payload = {
    message: {
      raw: encodeMessage(input),
      ...(thread ? { threadId: String(thread.gmailThreadId) } : {})
    }
  };
  const result = await jsonResponse<{ id: string; message?: { id?: string } }>(
    await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    }),
    "Gmail draft creation failed."
  );
  return persistDraft({
    ...input,
    gmailDraftId: result.id,
    gmailMessageId: result.message?.id ?? null
  });
}

export async function reviseGmailDraft(input: DraftInput & {
  draftId: string;
  fetcher?: Fetcher;
}) {
  const current = await getDraft(input.draftId);
  if (!current) throw new Error("Gmail draft not found.");
  const fetcher = input.fetcher ?? fetch;
  const token = await accessToken(String(current.connectionId), fetcher);
  const result = await jsonResponse<{ id: string; message?: { id?: string } }>(
    await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(String(current.gmailDraftId))}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ message: { raw: encodeMessage(input) } })
    }),
    "Gmail draft revision failed."
  );
  return updateDraft(current, input, result.message?.id ?? null);
}

export async function importGmailAttachment(input: {
  attachmentId: string;
  projectId: string;
  fetcher?: Fetcher;
  storeObject?: typeof storeBinaryObject;
}) {
  const attachment = await getAttachment(input.attachmentId);
  if (!attachment) throw new Error("Gmail attachment not found.");
  if (attachment.documentId) return { attachment, documentId: attachment.documentId, reused: true };
  const message = await getMirroredMessage(String(attachment.messageId));
  if (!message) throw new Error("Gmail message not found.");
  const fetcher = input.fetcher ?? fetch;
  const token = await accessToken(String(message.connectionId), fetcher);
  const response = await fetcher(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(String(message.gmailMessageId))}/attachments/${encodeURIComponent(String(attachment.gmailAttachmentId))}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const payload = await jsonResponse<{ data: string; size?: number }>(response, "Gmail attachment download failed.");
  const bytes = Buffer.from(payload.data, "base64url");
  const contentHash = sha256(bytes);
  const storageKey = `gmail/${message.connectionId}/${message.gmailMessageId}/${contentHash}-${safeName(String(attachment.filename))}`;
  await (input.storeObject ?? storeBinaryObject)(storageKey, String(attachment.mimeType), bytes);
  if (db) {
    await db.insert(storageObjects).values({
      organizationId: MTI_ORGANIZATION_ID,
      key: storageKey,
      contentType: String(attachment.mimeType),
      size: bytes.byteLength
    }).onConflictDoNothing();
  }
  const converted = await convertToMarkdown(String(attachment.filename), String(attachment.mimeType), bytes)
    .catch(() => ({
      title: String(attachment.filename),
      kind: "gmail_attachment",
      pageCount: null,
      wordCount: 0,
      markdown: "",
      truncated: false
    }));
  const folders = await repository.listFolders();
  const folder = folders.find((item) => item.name === "Project files") ?? folders[0];
  if (!folder) throw new Error("Document folder not found.");
  const document = await repository.createDocument({
    folderId: folder.id,
    projectId: input.projectId,
    title: converted.title,
    filename: String(attachment.filename),
    mimeType: String(attachment.mimeType),
    sourceKind: "gmail_attachment",
    sizeBytes: bytes.byteLength,
    pageCount: converted.pageCount,
    wordCount: converted.wordCount,
    markdown: [
      `<!-- source:gmail message:${message.gmailMessageId} attachment:${attachment.gmailAttachmentId} hash:${contentHash} -->`,
      converted.markdown
    ].join("\n"),
    storageKey
  });
  await markAttachmentImported(String(attachment.id), storageKey, contentHash, document.id);
  return { attachmentId: attachment.id, document, reused: false };
}

type DraftInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
};
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessagePayload = {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPart;
};
type GmailThreadPayload = {
  id: string;
  historyId?: string;
  messages?: GmailMessagePayload[];
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
    const existing = memory.connections.find((item) => item.googleAccountId === input.googleAccountId);
    if (existing) Object.assign(existing, values, { updatedAt: new Date().toISOString() });
    else memory.connections.push({ id: randomUUID(), ...values, createdAt: new Date().toISOString() });
    return publicConnection(existing ?? memory.connections.at(-1)!);
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

async function mirrorThread(connectionId: string, raw: GmailThreadPayload) {
  const messages = raw.messages ?? [];
  const first = messages[0];
  const last = messages.at(-1);
  const subject = header(first?.payload, "Subject");
  const participants = [...new Set(messages.flatMap((message) => [
    header(message.payload, "From"),
    ...addressList(header(message.payload, "To")),
    ...addressList(header(message.payload, "Cc"))
  ]).filter(Boolean))];
  const threadValues = {
    organizationId: MTI_ORGANIZATION_ID,
    connectionId,
    gmailThreadId: raw.id,
    historyId: raw.historyId ?? null,
    subject,
    snippet: last?.snippet ?? "",
    participants,
    lastMessageAt: last?.internalDate ? new Date(Number(last.internalDate)) : null
  };
  let thread: Record<string, unknown>;
  if (!db) {
    const existing = memory.threads.find((item) =>
      item.connectionId === connectionId && item.gmailThreadId === raw.id
    );
    if (existing) Object.assign(existing, threadValues);
    else memory.threads.push({ id: randomUUID(), ...threadValues });
    thread = existing ?? memory.threads.at(-1)!;
  } else {
    [thread] = await db.insert(gmailThreads).values(threadValues).onConflictDoUpdate({
      target: [gmailThreads.connectionId, gmailThreads.gmailThreadId],
      set: { ...threadValues, updatedAt: new Date() }
    }).returning();
  }
  const mirroredMessages = [];
  for (const message of messages) mirroredMessages.push(await mirrorMessage(connectionId, String(thread.id), message));
  return { ...thread, messages: mirroredMessages };
}

async function mirrorMessage(connectionId: string, threadId: string, raw: GmailMessagePayload) {
  const bodies = extractBodies(raw.payload);
  const values = {
    organizationId: MTI_ORGANIZATION_ID,
    connectionId,
    threadId,
    gmailMessageId: raw.id,
    internetMessageId: header(raw.payload, "Message-ID") || null,
    fromAddress: header(raw.payload, "From"),
    toAddresses: addressList(header(raw.payload, "To")),
    ccAddresses: addressList(header(raw.payload, "Cc")),
    subject: header(raw.payload, "Subject"),
    sentAt: raw.internalDate ? new Date(Number(raw.internalDate)) : null,
    snippet: raw.snippet ?? "",
    bodyText: bodies.text,
    bodyHtml: bodies.html,
    labelIds: raw.labelIds ?? []
  };
  let message: Record<string, unknown>;
  if (!db) {
    const existing = memory.messages.find((item) =>
      item.connectionId === connectionId && item.gmailMessageId === raw.id
    );
    if (existing) Object.assign(existing, values);
    else memory.messages.push({ id: randomUUID(), ...values });
    message = existing ?? memory.messages.at(-1)!;
  } else {
    [message] = await db.insert(gmailMessages).values(values).onConflictDoUpdate({
      target: [gmailMessages.connectionId, gmailMessages.gmailMessageId],
      set: { ...values, updatedAt: new Date() }
    }).returning();
  }
  for (const item of extractAttachments(raw.payload)) {
    const attachmentValues = {
      organizationId: MTI_ORGANIZATION_ID,
      messageId: String(message.id),
      gmailAttachmentId: item.attachmentId,
      filename: item.filename,
      mimeType: item.mimeType,
      sizeBytes: item.size
    };
    if (!db) {
      if (!memory.attachments.some((entry) =>
        entry.messageId === message.id && entry.gmailAttachmentId === item.attachmentId
      )) memory.attachments.push({ id: randomUUID(), ...attachmentValues, documentId: null });
    } else {
      await db.insert(gmailAttachments).values(attachmentValues).onConflictDoNothing();
    }
  }
  return { ...message, attachments: await listMessageAttachments(String(message.id)) };
}

function extractBodies(part?: GmailPart): { text: string; html: string } {
  if (!part) return { text: "", html: "" };
  const own = part.body?.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : "";
  const children = (part.parts ?? []).map(extractBodies);
  return {
    text: [part.mimeType === "text/plain" ? own : "", ...children.map((item) => item.text)].filter(Boolean).join("\n"),
    html: [part.mimeType === "text/html" ? own : "", ...children.map((item) => item.html)].filter(Boolean).join("\n")
  };
}

function extractAttachments(part?: GmailPart): Array<{
  attachmentId: string; filename: string; mimeType: string; size: number;
}> {
  if (!part) return [];
  const own = part.filename && part.body?.attachmentId ? [{
    attachmentId: part.body.attachmentId,
    filename: part.filename,
    mimeType: part.mimeType ?? "application/octet-stream",
    size: part.body.size ?? 0
  }] : [];
  return [...own, ...(part.parts ?? []).flatMap(extractAttachments)];
}

function header(part: GmailPart | undefined, name: string) {
  return part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function addressList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function encodeMessage(input: DraftInput) {
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

async function persistDraft(input: DraftInput & {
  connectionId: string; projectId: string; threadId?: string | null;
  gmailDraftId: string; gmailMessageId: string | null;
}) {
  const values = {
    id: randomUUID(),
    organizationId: MTI_ORGANIZATION_ID,
    connectionId: input.connectionId,
    projectId: input.projectId,
    threadId: input.threadId ?? null,
    gmailDraftId: input.gmailDraftId,
    gmailMessageId: input.gmailMessageId,
    toAddresses: input.to,
    ccAddresses: input.cc ?? [],
    bccAddresses: input.bcc ?? [],
    subject: input.subject,
    bodyText: input.bodyText,
    status: "draft",
    revision: 1
  };
  const revision = {
    id: randomUUID(),
    draftId: values.id,
    revision: 1,
    toAddresses: values.toAddresses,
    ccAddresses: values.ccAddresses,
    bccAddresses: values.bccAddresses,
    subject: values.subject,
    bodyText: values.bodyText,
    createdBy: MTI_OPERATOR_ID
  };
  if (!db) {
    memory.drafts.push(values);
    memory.revisions.push(revision);
    return values;
  }
  return db.transaction(async (tx) => {
    const [draft] = await tx.insert(gmailDrafts).values(values).returning();
    await tx.insert(gmailDraftRevisions).values(revision);
    return draft;
  });
}

async function getDraft(id: string) {
  if (!db) return memory.drafts.find((item) => item.id === id) ?? null;
  const [row] = await db.select().from(gmailDrafts).where(and(
    eq(gmailDrafts.id, id),
    eq(gmailDrafts.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  return row ?? null;
}

async function updateDraft(current: Record<string, unknown>, input: DraftInput, gmailMessageId: string | null) {
  const revision = Number(current.revision) + 1;
  const values = {
    toAddresses: input.to,
    ccAddresses: input.cc ?? [],
    bccAddresses: input.bcc ?? [],
    subject: input.subject,
    bodyText: input.bodyText,
    gmailMessageId,
    revision
  };
  if (!db) {
    Object.assign(current, values);
    memory.revisions.push({
      id: randomUUID(), draftId: current.id,
      ...values, createdBy: MTI_OPERATOR_ID
    });
    return current;
  }
  return db.transaction(async (tx) => {
    const [draft] = await tx.update(gmailDrafts).set({ ...values, updatedAt: new Date() })
      .where(eq(gmailDrafts.id, String(current.id))).returning();
    await tx.insert(gmailDraftRevisions).values({
      draftId: draft.id,
      revision,
      toAddresses: input.to,
      ccAddresses: input.cc ?? [],
      bccAddresses: input.bcc ?? [],
      subject: input.subject,
      bodyText: input.bodyText,
      createdBy: MTI_OPERATOR_ID
    });
    return draft;
  });
}

async function getMirroredThread(id: string) {
  if (!db) return memory.threads.find((item) => item.id === id) ?? null;
  const [row] = await db.select().from(gmailThreads).where(and(
    eq(gmailThreads.id, id),
    eq(gmailThreads.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  return row ?? null;
}

async function getMirroredMessage(id: string) {
  if (!db) return memory.messages.find((item) => item.id === id) ?? null;
  const [row] = await db.select().from(gmailMessages).where(and(
    eq(gmailMessages.id, id),
    eq(gmailMessages.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  return row ?? null;
}

async function getAttachment(id: string) {
  if (!db) return memory.attachments.find((item) => item.id === id) ?? null;
  const [row] = await db.select({ attachment: gmailAttachments })
    .from(gmailAttachments)
    .innerJoin(gmailMessages, eq(gmailMessages.id, gmailAttachments.messageId))
    .where(and(
      eq(gmailAttachments.id, id),
      eq(gmailMessages.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
  return row?.attachment ?? null;
}

async function listMessageAttachments(messageId: string) {
  if (!db) return memory.attachments.filter((item) => item.messageId === messageId);
  return db.select().from(gmailAttachments).where(eq(gmailAttachments.messageId, messageId));
}

async function markAttachmentImported(id: string, storageKey: string, contentHash: string, documentId: string) {
  if (!db) {
    const item = memory.attachments.find((entry) => entry.id === id);
    if (item) Object.assign(item, { storageKey, contentHash, documentId, importedAt: new Date().toISOString() });
    return;
  }
  await db.update(gmailAttachments).set({
    storageKey, contentHash, documentId, importedAt: new Date()
  }).where(eq(gmailAttachments.id, id));
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

function safeName(value: string) {
  return value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180) || "attachment";
}

export function getGmailTestState() {
  return memory;
}
