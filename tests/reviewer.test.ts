import { describe, expect, it } from "vitest";
import { formatDiff, parseAddedOrContextLines } from "../src/reviewer.js";

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
