import { beforeEach, describe, expect, it } from "vitest";
import {
  completeGmailAuthorization,
  createGmailAuthorization,
  createGmailDraft,
  decryptSecret,
  encryptSecret,
  getGmailTestState,
  importGmailAttachment,
  linkGmailToProject,
  retrieveGmailThread,
  reviseGmailDraft,
  searchGmailThreads
} from "@/lib/gmail";
import { internalToolCatalog } from "@/lib/mcp/catalog";
import { repository } from "@/lib/repository";

const key = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-client.test";
  process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret.test";
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = key;
  process.env.APP_URL = "http://localhost:3000";
  for (const list of Object.values(getGmailTestState())) list.splice(0);
});

describe("Gmail OAuth custody", () => {
  it("uses only readonly/compose offline scopes and consumes state once", async () => {
    const authorization = await createGmailAuthorization({});
    const url = new URL(authorization.url);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.readonly"
    ]);
    const state = url.searchParams.get("state")!;
    const fetcher = async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target.includes("oauth2.googleapis.com/token")) {
        return Response.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose"
        });
      }
      return Response.json({ emailAddress: "operator@example.com" });
    };
    const connection = await completeGmailAuthorization({
      code: "authorization-code",
      state,
      fetcher: fetcher as typeof fetch
    });
    expect(connection).toMatchObject({ email: "operator@example.com", status: "active" });
    expect(JSON.stringify(connection)).not.toContain("access-token");
    expect(JSON.stringify(connection)).not.toContain("refresh-token");
    const stored = getGmailTestState().connections[0];
    expect(stored.encryptedRefreshToken).not.toBe("refresh-token");
    expect(decryptSecret(String(stored.encryptedRefreshToken))).toBe("refresh-token");
    await expect(completeGmailAuthorization({
      code: "authorization-code",
      state,
      fetcher: fetcher as typeof fetch
    })).rejects.toThrow(/state/i);
  });

  it("uses authenticated encryption and rejects tampering", () => {
    const encrypted = encryptSecret("sensitive-token");
    expect(decryptSecret(encrypted)).toBe("sensitive-token");
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("a") ? "b" : "a"}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("Gmail project workflow", () => {
  async function connected() {
    const authorization = await createGmailAuthorization({});
    const state = new URL(authorization.url).searchParams.get("state")!;
    const fetcher = async (input: RequestInfo | URL) => {
      if (String(input).includes("token")) {
        return Response.json({
          access_token: "cached-access",
          refresh_token: "cached-refresh",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose"
        });
      }
      return Response.json({ emailAddress: "mailbox@example.com" });
    };
    return completeGmailAuthorization({ code: "code", state, fetcher: fetcher as typeof fetch });
  }

  it("mirrors selected threads, links them, imports attachments, and preserves provenance", async () => {
    const connection = await connected();
    const project = await repository.createProject({
      name: `Gmail project ${crypto.randomUUID()}`,
      objective: "Use selected communication context.",
      context: "",
      scope: "",
      constraints: [],
      budgetCents: 1000
    });
    const threadPayload = {
      id: "thread-1",
      historyId: "91",
      messages: [{
        id: "message-1",
        threadId: "thread-1",
        internalDate: "1785299000000",
        labelIds: ["INBOX"],
        snippet: "Attached scope",
        payload: {
          mimeType: "multipart/mixed",
          headers: [
            { name: "From", value: "client@example.com" },
            { name: "To", value: "mailbox@example.com" },
            { name: "Subject", value: "Project scope" },
            { name: "Message-ID", value: "<message-1@example.com>" }
          ],
          parts: [
            {
              mimeType: "text/plain",
              body: { data: Buffer.from("Please review attached scope.").toString("base64url") }
            },
            {
              mimeType: "text/plain",
              filename: "scope.txt",
              body: { attachmentId: "attachment-1", size: 18 }
            }
          ]
        }
      }]
    };
    const gmailFetch = async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target.endsWith("/threads?q=scope&maxResults=10")) {
        return Response.json({ threads: [{ id: "thread-1" }] });
      }
      if (target.includes("/attachments/attachment-1")) {
        return Response.json({ data: Buffer.from("Approved scope text").toString("base64url"), size: 19 });
      }
      if (target.includes("/threads/thread-1")) return Response.json(threadPayload);
      throw new Error(`Unexpected URL ${target}`);
    };
    const results = await searchGmailThreads({
      connectionId: String(connection.id),
      query: "scope",
      maxResults: 10,
      fetcher: gmailFetch as typeof fetch
    });
    expect(results).toHaveLength(1);
    const thread = results[0] as Record<string, unknown> & {
      messages: Array<Record<string, unknown> & { attachments: Array<Record<string, unknown>> }>;
    };
    expect(thread.subject).toBe("Project scope");
    expect(thread.messages[0].bodyText).toContain("review attached scope");
    const attachment = thread.messages[0].attachments[0];
    expect(attachment.filename).toBe("scope.txt");

    const link = await linkGmailToProject({
      projectId: project.id,
      threadId: String(thread.id)
    });
    expect(link).toMatchObject({ projectId: project.id, threadId: thread.id });

    const imported = await importGmailAttachment({
      attachmentId: String(attachment.id),
      projectId: project.id,
      fetcher: gmailFetch as typeof fetch,
      storeObject: async (storageKey, contentType, body) => ({
        key: storageKey, contentType, size: body.byteLength
      })
    });
    if (!imported.document) throw new Error("Expected a newly imported document.");
    expect(imported.document.projectId).toBe(project.id);
    expect(imported.document.markdown).toContain("Approved scope text");
    expect(imported.provenance).toMatchObject({
      gmailMessageId: "message-1",
      gmailAttachmentId: "attachment-1"
    });
  });

  it("creates and revises Gmail drafts without exposing send or delete tools", async () => {
    const connection = await connected();
    const project = await repository.createProject({
      name: `Draft project ${crypto.randomUUID()}`,
      objective: "Prepare controlled client communication.",
      context: "",
      scope: "",
      constraints: [],
      budgetCents: 1000
    });
    let calls = 0;
    const draftFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { message: { raw: string } };
      const decoded = Buffer.from(body.message.raw, "base64url").toString("utf8");
      expect(decoded).toContain("To: client@example.com");
      return Response.json({ id: "gmail-draft-1", message: { id: `draft-message-${calls}` } });
    };
    const draft = await createGmailDraft({
      connectionId: String(connection.id),
      projectId: project.id,
      to: ["client@example.com"],
      subject: "First draft",
      bodyText: "Draft only.",
      fetcher: draftFetch as typeof fetch
    });
    const revised = await reviseGmailDraft({
      draftId: String(draft.id),
      to: ["client@example.com"],
      subject: "Revised draft",
      bodyText: "Still draft only.",
      fetcher: draftFetch as typeof fetch
    });
    expect(revised).toMatchObject({ revision: 2, subject: "Revised draft", status: "draft" });
    expect(getGmailTestState().revisions).toHaveLength(2);

    const toolNames = internalToolCatalog.map((tool) => tool.name);
    expect(toolNames).toContain("create_gmail_draft");
    expect(toolNames).toContain("revise_gmail_draft");
    expect(toolNames.some((name) => /gmail.*(send|delete|forward|delegate)/i.test(name))).toBe(false);

    await expect(createGmailDraft({
      connectionId: String(connection.id),
      projectId: project.id,
      to: ["client@example.com"],
      subject: "Safe subject\r\nBcc: injected@example.com",
      bodyText: "Blocked.",
      fetcher: draftFetch as typeof fetch
    })).rejects.toThrow(/headers/i);
  });

  it("retrieves only explicitly selected thread IDs", async () => {
    const connection = await connected();
    const called: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      called.push(String(input));
      return Response.json({ id: "selected-thread", messages: [] });
    };
    await retrieveGmailThread({
      connectionId: String(connection.id),
      gmailThreadId: "selected-thread",
      fetcher: fetcher as typeof fetch
    });
    expect(called).toHaveLength(1);
    expect(called[0]).toContain("/threads/selected-thread");
  });
});
