import { beforeEach, describe, expect, it } from "vitest";
import {
  completeGmailAuthorization,
  createGmailAuthorization,
  decryptSecret,
  encryptSecret,
  getGmailTestState,
  sendServiceEmail,
  setGmailServiceSender
} from "@/lib/gmail";
import { internalToolCatalog } from "@/lib/mcp/catalog";

const key = Buffer.alloc(32, 7).toString("base64");
const sendScope = "https://www.googleapis.com/auth/gmail.send";

beforeEach(() => {
  process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-client.test";
  process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret.test";
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = key;
  process.env.APP_URL = "http://localhost:3000";
  for (const list of Object.values(getGmailTestState())) list.splice(0);
});

async function connectSender(scopes = `openid email ${sendScope}`) {
  const authorization = await createGmailAuthorization({});
  const state = new URL(authorization.url).searchParams.get("state")!;
  const requests: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const target = String(input);
    requests.push(target);
    if (target.includes("oauth2.googleapis.com/token")) {
      return Response.json({
        access_token: "cached-access",
        refresh_token: "cached-refresh",
        expires_in: 3600,
        scope: scopes
      });
    }
    if (target === "https://openidconnect.googleapis.com/v1/userinfo") {
      return Response.json({
        sub: "google-account-123",
        email: "mailbox@example.com",
        email_verified: true
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  const connection = await completeGmailAuthorization({
    code: "code",
    state,
    fetcher: fetcher as typeof fetch
  });
  return { connection, requests };
}

describe("Gmail send-only OAuth custody", () => {
  it("requests send plus identity only and never carries forward old mailbox grants", async () => {
    const authorization = await createGmailAuthorization({});
    const url = new URL(authorization.url);

    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "email",
      sendScope,
      "openid"
    ].sort());
    expect(url.searchParams.get("scope")).not.toMatch(/gmail\.(readonly|compose|modify|metadata)/);
  });

  it("uses OIDC identity instead of a Gmail mailbox profile endpoint", async () => {
    const { connection, requests } = await connectSender();

    expect(connection).toMatchObject({
      googleAccountId: "google-account-123",
      email: "mailbox@example.com",
      status: "active"
    });
    expect(requests).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://openidconnect.googleapis.com/v1/userinfo"
    ]);
    expect(requests.some((url) => url.includes("gmail.googleapis.com"))).toBe(false);
    expect(JSON.stringify(connection)).not.toContain("cached-access");
    expect(JSON.stringify(connection)).not.toContain("cached-refresh");
    expect(decryptSecret(String(getGmailTestState().connections[0].encryptedRefreshToken)))
      .toBe("cached-refresh");
  });

  it("requires gmail.send and consumes each OAuth state once", async () => {
    const authorization = await createGmailAuthorization({});
    const state = new URL(authorization.url).searchParams.get("state")!;
    const fetcher = async () => Response.json({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: "openid email"
    });

    await expect(completeGmailAuthorization({
      code: "authorization-code",
      state,
      fetcher: fetcher as typeof fetch
    })).rejects.toThrow(/required scopes/i);
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

describe("Gmail automated notification sender", () => {
  it("sends through messages.send and exposes no Gmail MCP tools", async () => {
    const { connection } = await connectSender();
    await setGmailServiceSender(String(connection.id), crypto.randomUUID());
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await sendServiceEmail({
      to: "recipient@example.com",
      subject: "Report ready",
      bodyText: "Your report is ready for review.",
      fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return Response.json({ id: "sent-message-1", threadId: "sent-thread-1" });
      }) as typeof fetch
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(calls[0].init?.method).toBe("POST");
    expect(result).toMatchObject({
      gmailMessageId: "sent-message-1",
      sender: "mailbox@example.com"
    });

    const raw = JSON.parse(String(calls[0].init?.body)).raw as string;
    expect(Buffer.from(raw, "base64url").toString("utf8")).toContain("To: recipient@example.com");
    expect(internalToolCatalog.some((tool) =>
      tool.name.includes("gmail") || tool.permissions.some((permission) => permission.startsWith("gmail:"))
    )).toBe(false);
  });

  it("refuses legacy authorization or stored connections with mailbox grants", async () => {
    await expect(connectSender(
      `openid email ${sendScope} https://www.googleapis.com/auth/gmail.readonly`
    )).rejects.toThrow(/mailbox scopes/i);

    const { connection } = await connectSender();
    const stored = getGmailTestState().connections[0];
    stored.scopes = [sendScope, "https://www.googleapis.com/auth/gmail.compose"];
    await expect(setGmailServiceSender(String(connection.id), crypto.randomUUID()))
      .rejects.toThrow(/send-only permission/i);
  });
});
