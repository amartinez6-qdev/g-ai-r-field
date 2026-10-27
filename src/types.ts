export type ReviewSeverity = "critical" | "high" | "medium" | "low";

export type Repository = {
  owner: string;
  name: string;
};

export type ReviewFile = {
  path: string;
  patch?: string;
  additions: number;
  deletions: number;
};

export type PullRequestSnapshot = {
  repository: Repository;
  number: number;
  title: string;
  body: string;
  headSha: string;
  baseBranch: string;
  draft: boolean;
  files: ReviewFile[];
};

export type Finding = {
  severity: ReviewSeverity;
  category: "correctness" | "security" | "tests" | "maintainability";
  title: string;
  body: string;
  path?: string;
  line?: number;
  endLine?: number;
  confidence: number;
};

export type ReviewResult = {
  summary: string;
  findings: Finding[];
};

export type ContextChunk = {
  path: string;
  sourceType: string;
  lineStart: number;
  lineEnd: number;
  content: string;
};

export type ReviewerConfig = {
  repos: string[];
  events: string[];
  review: {
    model: string;
    drafts: boolean;
    maxDiffLines: number;
    maxInlineComments: number;
    minInlineSeverity: ReviewSeverity;
  };
  context: {
    enabled: boolean;
    maxChunks: number;
    maxDocumentBytes: number;
    retainedSnapshots: number;
    include: string[];
  };
};

export type AppConfig = ReviewerConfig & {
  port: number;
  host: string;
  databasePath: string;
  github: {
    apiUrl: string;
    token?: string;
    webhookSecret: string;
    appId?: number;
    appPrivateKeyPath?: string;
    installationId?: number;
  };
  omniroute: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
};

export type ReviewJob = {
  repository: Repository;
  pullNumber: number;
  headSha: string;
  deliveryId: string;
};

export function repositoryKey(repository: Repository): string {
  return `${repository.owner}/${repository.name}`;
}

export function parseRepository(value: string): Repository {
  const [owner, name, ...rest] = value.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error(`Invalid repository identifier: ${value}`);
  }
  return { owner, name };
}
