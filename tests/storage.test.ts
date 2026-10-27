import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../src/storage.js";

describe("local context storage", () => {
  it("deduplicates active work but allows a redelivery for the same commit", () => {
    const directory = mkdtempSync(join(tmpdir(), "g-air-field-"));
    const storage = new Storage(join(directory, "test.sqlite"));
    const repository = { owner: "acme", name: "project" };

    expect(storage.upsertJob(repository, 1, "abc123", "delivery-1")).toBe(true);
    expect(storage.upsertJob(repository, 1, "abc123", "delivery-1")).toBe(false);
    storage.setJobStatus(repository, 1, "abc123", "succeeded");
    expect(storage.upsertJob(repository, 1, "abc123", "delivery-1")).toBe(true);

    storage.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("indexes and retrieves context chunks", () => {
    const directory = mkdtempSync(join(tmpdir(), "g-air-field-"));
    const storage = new Storage(join(directory, "test.sqlite"));
    const repository = { owner: "acme", name: "project" };
    storage.replaceSnapshot(repository, "abc123", [
      {
        path: "AGENTS.md",
        sourceType: "repository-policy",
        lineStart: 1,
        lineEnd: 3,
        content: "Use service boundaries and validate all public inputs.",
      },
    ]);

    expect(storage.isSnapshotIndexed(repository, "abc123")).toBe(true);
    expect(storage.searchContext(repository, "abc123", "service boundaries", 5)).toHaveLength(1);
    storage.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
