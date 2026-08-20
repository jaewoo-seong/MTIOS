import { afterEach, describe, expect, it } from "vitest";
import { getAppUrl } from "@/lib/app-url";

afterEach(() => {
  delete process.env.APP_URL;
});

describe("application URL resolution", () => {
  it("uses the configured public URL instead of an internal request host", () => {
    process.env.APP_URL = "https://app-production.example.com/base?ignored=yes";
    expect(getAppUrl("https://localhost:8080/api/v1/integrations/gmail/callback").toString())
      .toBe("https://app-production.example.com/");
  });

  it("falls back to the request origin when APP_URL is absent", () => {
    expect(getAppUrl("https://preview.example.com/api/callback").toString())
      .toBe("https://preview.example.com/");
  });

  it("rejects non-web redirect protocols", () => {
    process.env.APP_URL = "javascript:alert(1)";
    expect(() => getAppUrl("https://safe.example.com/callback")).toThrow(/http or https/i);
  });
});
