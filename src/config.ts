import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { AppConfig, ReviewerConfig } from "./types.js";

const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);

const FileConfigSchema = z.object({
  repos: z.array(z.string()).default([]),
  events: z.array(z.string()).default(["opened", "reopened", "synchronize", "ready_for_review"]),
  review: z
    .object({
      model: z.string().default("auto"),
      drafts: z.boolean().default(false),
      max_diff_lines: z.number().int().positive().default(1200),
      max_inline_comments: z.number().int().positive().default(10),
      min_inline_severity: SeveritySchema.default("medium"),
    })
    .default({
      model: "auto",
      drafts: false,
      max_diff_lines: 1200,
      max_inline_comments: 10,
      min_inline_severity: "medium",
    }),
  context: z
    .object({
      enabled: z.boolean().default(true),
      max_chunks: z.number().int().positive().default(10),
      max_document_bytes: z.number().int().positive().default(262144),
      retained_snapshots: z.number().int().positive().default(5),
      include: z
        .array(z.string())
        .default(["AGENTS.md", "README.md", "CONTRIBUTING.md", "docs/**", ".github/**"]),
    })
    .default({
      enabled: true,
      max_chunks: 10,
      max_document_bytes: 262144,
      retained_snapshots: 5,
      include: ["AGENTS.md", "README.md", "CONTRIBUTING.md", "docs/**", ".github/**"],
    }),
});

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] || fallback;
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function toReviewerConfig(raw: unknown): ReviewerConfig {
  const parsed = FileConfigSchema.parse(raw ?? {});
  return {
    repos: parsed.repos,
    events: parsed.events,
    review: {
      model: parsed.review.model,
      drafts: parsed.review.drafts,
      maxDiffLines: parsed.review.max_diff_lines,
      maxInlineComments: parsed.review.max_inline_comments,
      minInlineSeverity: parsed.review.min_inline_severity,
    },
    context: {
      enabled: parsed.context.enabled,
      maxChunks: parsed.context.max_chunks,
      maxDocumentBytes: parsed.context.max_document_bytes,
      retainedSnapshots: parsed.context.retained_snapshots,
      include: parsed.context.include,
    },
  };
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  const configPathValue = env("CONFIG_PATH", "reviewer.config.yml")!;
  const configPath = isAbsolute(configPathValue) ? configPathValue : resolve(cwd, configPathValue);
  const raw = existsSync(configPath) ? YAML.parse(readFileSync(configPath, "utf8")) : {};
  const reviewer = toReviewerConfig(raw);
  if (reviewer.repos.length === 0 || reviewer.repos.some((repo) => repo === "owner/project")) {
    throw new Error(
      `Configure at least one real repository in ${configPath}; replace the placeholder owner/project.`,
    );
  }

  const privateKeyPath = env("GITHUB_APP_PRIVATE_KEY_PATH");
  const privateKeyAbsolute = privateKeyPath
    ? isAbsolute(privateKeyPath)
      ? privateKeyPath
      : resolve(dirname(configPath), privateKeyPath)
    : undefined;
  const appId = env("GITHUB_APP_ID");
  const installationId = env("GITHUB_INSTALLATION_ID");

  const token = env("GITHUB_TOKEN");
  const webhookSecret = requiredEnv("GITHUB_WEBHOOK_SECRET");
  if (webhookSecret === "change-me" || webhookSecret.length < 16) {
    throw new Error("GITHUB_WEBHOOK_SECRET must be a random value of at least 16 characters.");
  }
  if (!token && !(appId && privateKeyAbsolute && installationId)) {
    throw new Error(
      "Configure GITHUB_TOKEN or the complete GitHub App credentials: GITHUB_APP_ID, " +
        "GITHUB_APP_PRIVATE_KEY_PATH and GITHUB_INSTALLATION_ID.",
    );
  }

  return {
    ...reviewer,
    port: Number(env("PORT", "8787")),
    host: env("HOST", "127.0.0.1")!,
    databasePath: resolve(cwd, env("DATABASE_PATH", "data/g-air-field.sqlite")!),
    github: {
      apiUrl: env("GITHUB_API_URL", "https://api.github.com")!,
      token,
      webhookSecret,
      appId: appId ? Number(appId) : undefined,
      appPrivateKeyPath: privateKeyAbsolute,
      installationId: installationId ? Number(installationId) : undefined,
    },
    omniroute: {
      baseUrl: env("OMNIROUTE_BASE_URL", "http://127.0.0.1:20128/v1")!,
      apiKey: env("OMNIROUTE_API_KEY", "")!,
      model: env("OMNIROUTE_MODEL", reviewer.review.model)!,
    },
  };
}
