import { describe, expect, it } from "vitest";
import {
  bearerToken,
  generateExternalMcpToken,
  hashExternalMcpToken,
  parseExternalMcpToken,
  requestHash,
  validateExternalMcpScopes,
  verifyExternalMcpToken
} from "@/lib/mcp/external-credentials";

describe("external MCP credentials", () => {
  it("creates parseable high-entropy tokens without exposing the secret separately", () => {
    const generated = generateExternalMcpToken();
    expect(generated.token).toMatch(/^mti_mcp_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/);
    expect(parseExternalMcpToken(generated.token)).toEqual({ publicPrefix: generated.publicPrefix, token: generated.token });
    expect(parseExternalMcpToken("mti_mcp_invalid")).toBeNull();
  });

  it("extracts only a Bearer credential", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it("hashes secrets with Argon2 and verifies without storing plaintext", async () => {
    const { token } = generateExternalMcpToken();
    const encoded = await hashExternalMcpToken(token);
    expect(encoded).toMatch(/^\$argon2/);
    expect(await verifyExternalMcpToken(token, encoded)).toBe(true);
    expect(await verifyExternalMcpToken(`${token}x`, encoded)).toBe(false);
  });

  it("rejects unknown scopes and removes duplicates", () => {
    expect(validateExternalMcpScopes(["projects:read", "projects:read"])).toEqual(["projects:read"]);
    expect(() => validateExternalMcpScopes(["admin:all"])).toThrow("Unknown external MCP scope");
  });

  it("produces stable request hashes regardless of object key order", () => {
    expect(requestHash({ a: 1, b: [2, 3] })).toBe(requestHash({ b: [2, 3], a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
  });
});
