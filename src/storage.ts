import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ContextChunk, Repository } from "./types.js";
import { repositoryKey } from "./types.js";

type SqlStatement = {
  run: (...values: unknown[]) => unknown;
  get: (...values: unknown[]) => unknown;
  all: (...values: unknown[]) => unknown[];
};

type SqlDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqlStatement;
  close: () => void;
};

type StoredJob = { status: "queued" | "running" | "succeeded" | "failed" };

export class Storage {
  private readonly db: SqlDatabase;

  public constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path) as unknown as SqlDatabase;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS jobs (
        repository TEXT NOT NULL,
        pull_number INTEGER NOT NULL,
        head_sha TEXT NOT NULL,
        delivery_id TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (repository, pull_number, head_sha)
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        repository TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (repository, head_sha)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(
        repository UNINDEXED,
        head_sha UNINDEXED,
        path,
        source_type,
        line_start UNINDEXED,
        line_end UNINDEXED,
        content
      );
    `);
  }

  public getJobStatus(
    repository: Repository,
    pullNumber: number,
    headSha: string,
  ): StoredJob | null {
    const row = this.db
      .prepare("SELECT status FROM jobs WHERE repository = ? AND pull_number = ? AND head_sha = ?")
      .get(repositoryKey(repository), pullNumber, headSha) as
      { status?: StoredJob["status"] } | undefined;
    return row?.status ? { status: row.status } : null;
  }

  public upsertJob(
    repository: Repository,
    pullNumber: number,
    headSha: string,
    deliveryId: string,
  ): boolean {
    const existing = this.getJobStatus(repository, pullNumber, headSha);
    if (
      existing?.status === "queued" ||
      existing?.status === "running" ||
      existing?.status === "succeeded"
    ) {
      return false;
    }
    this.db
      .prepare(
        `
        INSERT INTO jobs (repository, pull_number, head_sha, delivery_id, status)
        VALUES (?, ?, ?, ?, 'queued')
        ON CONFLICT(repository, pull_number, head_sha) DO UPDATE SET
          delivery_id = excluded.delivery_id,
          status = 'queued',
          error = NULL,
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(repositoryKey(repository), pullNumber, headSha, deliveryId);
    return true;
  }

  public setJobStatus(
    repository: Repository,
    pullNumber: number,
    headSha: string,
    status: StoredJob["status"],
    error?: string,
  ): void {
    this.db
      .prepare(
        "UPDATE jobs SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE repository = ? AND pull_number = ? AND head_sha = ?",
      )
      .run(status, error ?? null, repositoryKey(repository), pullNumber, headSha);
  }

  public isSnapshotIndexed(repository: Repository, headSha: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS found FROM snapshots WHERE repository = ? AND head_sha = ?")
      .get(repositoryKey(repository), headSha) as { found?: number } | undefined;
    return row?.found === 1;
  }

  public replaceSnapshot(repository: Repository, headSha: string, chunks: ContextChunk[]): void {
    const key = repositoryKey(repository);
    this.db
      .prepare("DELETE FROM context_fts WHERE repository = ? AND head_sha = ?")
      .run(key, headSha);
    const insert = this.db.prepare(
      "INSERT INTO context_fts (repository, head_sha, path, source_type, line_start, line_end, content) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const chunk of chunks) {
      insert.run(
        key,
        headSha,
        chunk.path,
        chunk.sourceType,
        chunk.lineStart,
        chunk.lineEnd,
        chunk.content,
      );
    }
    this.db
      .prepare(
        "INSERT INTO snapshots (repository, head_sha) VALUES (?, ?) ON CONFLICT(repository, head_sha) DO UPDATE SET indexed_at = CURRENT_TIMESTAMP",
      )
      .run(key, headSha);
  }

  public searchContext(
    repository: Repository,
    headSha: string,
    query: string,
    limit: number,
  ): ContextChunk[] {
    const terms = query
      .toLowerCase()
      .match(/[a-z0-9_./-]{2,}/g)
      ?.slice(0, 24)
      .map((term) => `"${term.replaceAll('"', '""')}"`);
    if (!terms?.length) return [];
    const match = terms.join(" OR ");
    const rows = this.db
      .prepare(
        `
        SELECT path, source_type AS sourceType, line_start AS lineStart, line_end AS lineEnd, content
        FROM context_fts
        WHERE repository = ? AND head_sha = ? AND context_fts MATCH ?
        ORDER BY bm25(context_fts)
        LIMIT ?
      `,
      )
      .all(repositoryKey(repository), headSha, match, limit) as Array<{
      path: string;
      sourceType: string;
      lineStart: number;
      lineEnd: number;
      content: string;
    }>;
    return rows;
  }

  public pruneSnapshots(repository: Repository, retained: number): void {
    const key = repositoryKey(repository);
    const rows = this.db
      .prepare(
        "SELECT head_sha AS headSha FROM snapshots WHERE repository = ? ORDER BY indexed_at DESC LIMIT -1 OFFSET ?",
      )
      .all(key, retained) as Array<{ headSha: string }>;
    for (const row of rows) {
      this.db
        .prepare("DELETE FROM context_fts WHERE repository = ? AND head_sha = ?")
        .run(key, row.headSha);
      this.db
        .prepare("DELETE FROM snapshots WHERE repository = ? AND head_sha = ?")
        .run(key, row.headSha);
    }
  }

  public close(): void {
    this.db.close();
  }
}
