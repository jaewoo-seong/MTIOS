import { describe, expect, it } from "vitest";
import { parseModelJson } from "@/lib/ai/model-json";

describe("parseModelJson", () => {
  it("parses plain JSON", () => {
    expect(parseModelJson<{ tasks: string[] }>('{"tasks":["verify"]}')).toEqual({
      tasks: ["verify"]
    });
  });

  it("parses JSON wrapped in a Markdown fence", () => {
    const content = '```json\n{"tasks":["verify"],"reportTitle":"Result"}\n```';
    expect(parseModelJson<{ tasks: string[]; reportTitle: string }>(content)).toEqual({
      tasks: ["verify"],
      reportTitle: "Result"
    });
  });
});
