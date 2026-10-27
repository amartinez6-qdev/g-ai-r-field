import { describe, expect, it } from "vitest";
import {
  findingKey,
  formatDiff,
  normalizeModelJson,
  parseAddedOrContextLines,
} from "../src/reviewer.js";

describe("diff handling", () => {
  it("maps added and context lines from a unified diff", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " line one",
      "+line two",
      " line three",
      "-old line",
      "+new line",
    ].join("\n");
    expect([...parseAddedOrContextLines(patch)]).toEqual([1, 2, 3, 4]);
  });

  it("limits formatted diffs", () => {
    const patch = Array.from({ length: 10 }, (_, index) => `+line ${index}`).join("\n");
    expect(formatDiff([{ path: "file.ts", patch, additions: 10, deletions: 0 }], 3)).toContain(
      "Diff truncated at 3 lines",
    );
  });
});

describe("finding identity", () => {
  it("keeps the same key when only the line changes", () => {
    const first = findingKey({
      path: "src/example.ts",
      category: "correctness",
      title: "Unsafe lookup",
      body: "The lookup can fail.",
      line: 10,
      confidence: 0.9,
      severity: "high",
    });
    const moved = findingKey({
      path: "src/example.ts",
      category: "correctness",
      title: "Unsafe lookup",
      body: "The lookup can fail with a different line.",
      line: 18,
      confidence: 0.9,
      severity: "high",
    });
    expect(moved).toBe(first);
  });
});

describe("model response parsing", () => {
  it("extracts JSON when a provider adds a short preamble", () => {
    expect(
      normalizeModelJson('We need to review this carefully. {"summary":"ok","findings":[]}'),
    ).toEqual({
      summary: "ok",
      findings: [],
    });
  });

  it("extracts JSON from a markdown fence", () => {
    expect(normalizeModelJson('```json\n{"summary":"ok","findings":[]}\n```')).toEqual({
      summary: "ok",
      findings: [],
    });
  });
});
