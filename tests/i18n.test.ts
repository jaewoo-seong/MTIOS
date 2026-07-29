import { describe, expect, it } from "vitest";
import { hasKoreanTranslation, translate } from "@/lib/i18n";

describe("localization", () => {
  it("translates core workflows and interpolates values", () => {
    expect(translate("ko", "Create project")).toBe("프로젝트 만들기");
    expect(translate("ko", "{count} words", { count: 12 })).toBe("12단어");
    expect(translate("en", "Create project")).toBe("Create project");
  });

  it("covers required Phase 12 workflow surfaces", () => {
    for (const label of [
      "Executive Agent",
      "Project Command Center",
      "Documents",
      "Client & Data",
      "Knowledge Base",
      "Settings",
      "Search workspace",
      "Create durable project context",
      "Client-data proposals",
      "Model routing",
      "MCP tools",
      "Live activity",
      "Approve extraction",
      "Save preferences"
    ]) {
      expect(hasKoreanTranslation(label), label).toBe(true);
    }
  });
});
