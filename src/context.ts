import { posix } from "node:path";
import type { GitHubClient, GitTreeEntry } from "./github.js";
import type { ContextChunk, PullRequestSnapshot, Repository, ReviewerConfig } from "./types.js";
import { Storage } from "./storage.js";

const DEFAULT_CONTEXT_PATTERNS = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "docs/**",
  ".github/**",
];
const BLOCKED_SEGMENTS = new Set(["node_modules", "vendor", "dist", "build", "coverage", ".git"]);
const BLOCKED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".woff",
  ".woff2",
]);

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "@@DOUBLE_STAR@@")
    .replaceAll("*", "[^/]*")
    .replaceAll("@@DOUBLE_STAR@@", ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesPattern(path: string, pattern: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (pattern.endsWith("/**"))
    return normalized.toLowerCase().startsWith(pattern.slice(0, -3).toLowerCase());
  return globToRegExp(pattern).test(normalized);
}

function isSafeContextPath(path: string): boolean {
  const lower = path.toLowerCase();
  const parts = lower.split("/");
  if (parts.some((part) => BLOCKED_SEGMENTS.has(part))) return false;
  if (parts.some((part) => part.startsWith(".env"))) return false;
  if (/(secret|credential|private[_-]?key|token)/i.test(lower)) return false;
  return !BLOCKED_EXTENSIONS.has(posix.extname(lower));
}

function sourceType(path: string): string {
  const lower = path.toLowerCase();
  if (posix.basename(lower) === "agents.md") return "repository-policy";
  if (lower.endsWith(".md")) return "documentation";
  return "configuration";
}

function ancestorAgentFiles(changedPath: string, treePaths: Set<string>): string[] {
  const result: string[] = [];
  let directory = posix.dirname(changedPath);
  while (directory !== ".") {
    const candidate = `${directory}/AGENTS.md`;
    if (treePaths.has(candidate)) result.push(candidate);
    directory = posix.dirname(directory);
  }
  if (treePaths.has("AGENTS.md")) result.push("AGENTS.md");
  return result;
}

function chunkDocument(path: string, content: string): ContextChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: ContextChunk[] = [];
  const maxLines = 70;
  const overlap = 5;
  for (let start = 0; start < lines.length; start += maxLines - overlap) {
    const selected = lines.slice(start, start + maxLines);
    if (selected.every((line) => line.trim() === "")) continue;
    chunks.push({
      path,
      sourceType: sourceType(path),
      lineStart: start + 1,
      lineEnd: Math.min(start + selected.length, lines.length),
      content: selected.join("\n").slice(0, 8000),
    });
    if (start + maxLines >= lines.length) break;
  }
  return chunks;
}

export class RepositoryContext {
  public constructor(
    private readonly github: GitHubClient,
    private readonly storage: Storage,
    private readonly config: ReviewerConfig["context"],
  ) {}

  public async ensureIndexed(snapshot: PullRequestSnapshot): Promise<void> {
    if (
      !this.config.enabled ||
      this.storage.isSnapshotIndexed(snapshot.repository, snapshot.headSha)
    )
      return;

    const tree = await this.github.listTree(snapshot.repository, snapshot.headSha);
    const treePaths = new Set(tree.flatMap((entry) => (entry.path ? [entry.path] : [])));
    const patterns =
      this.config.include.length > 0 ? this.config.include : DEFAULT_CONTEXT_PATTERNS;
    const selected = new Map<string, GitTreeEntry>();

    for (const entry of tree) {
      if (!entry.path || !entry.sha || !isSafeContextPath(entry.path)) continue;
      if (patterns.some((pattern) => matchesPattern(entry.path!, pattern)))
        selected.set(entry.path, entry);
    }
    for (const changedFile of snapshot.files) {
      for (const path of ancestorAgentFiles(changedFile.path, treePaths)) {
        const entry = tree.find((candidate) => candidate.path === path);
        if (entry?.path && entry.sha) selected.set(entry.path, entry);
      }
    }

    const chunks: ContextChunk[] = [];
    for (const [path, entry] of selected) {
      const content = await this.github.getBlob(
        snapshot.repository,
        entry.sha!,
        this.config.maxDocumentBytes,
      );
      if (content !== null) chunks.push(...chunkDocument(path, content));
    }
    this.storage.replaceSnapshot(snapshot.repository, snapshot.headSha, chunks);
    this.storage.pruneSnapshots(snapshot.repository, this.config.retainedSnapshots);
  }

  public retrieve(repository: Repository, headSha: string, query: string): ContextChunk[] {
    return this.storage.searchContext(repository, headSha, query, this.config.maxChunks);
  }
}
