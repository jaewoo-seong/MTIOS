import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings tools and access layout", () => {
  it("keeps tools and access in separate administrator tabs", () => {
    const settings = readFileSync("components/business-os.tsx", "utf8");

    expect(settings).toContain('["status", "models", "intelligence", "tools", "access", "workspace"]');
    expect(settings).toContain('tab === "tools"');
    expect(settings).toContain('tab === "access"');
    expect(settings).toContain('title="Connected capabilities"');
    expect(settings).toContain('title="People, credentials, and permissions"');
  });

  it("groups company accounts into administrators and members", () => {
    const accounts = readFileSync("components/account-settings.tsx", "utf8");
    const styles = readFileSync("app/globals.css", "utf8");

    expect(accounts).toContain('title: "Administrators"');
    expect(accounts).toContain('title: "Members"');
    expect(accounts).toContain('className={`account-role-section ${group.role}`}');
    expect(accounts).toContain("A welcome email will include the initial password");
    expect(styles).toContain(".account-role-section.admin");
    expect(styles).toContain(".settings-tool-columns");
  });
});
