import { readFileSync } from "node:fs";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { AppConfig } from "./types.js";
import type { PullRequestSnapshot, Repository, ReviewFile } from "./types.js";

type GitTreeEntry = {
  path?: string;
  type?: string;
  sha?: string;
  size?: number;
};

type ReviewComment = {
  path: string;
  body: string;
  line: number;
  side: "RIGHT";
  start_line?: number;
  start_side?: "RIGHT";
};

export class GitHubClient {
  private readonly config: AppConfig["github"];
  private appClient?: Octokit;
  private appTokenExpiresAt = 0;

  public constructor(config: AppConfig["github"]) {
    this.config = config;
  }

  private async client(): Promise<Octokit> {
    if (this.config.token)
      return new Octokit({ auth: this.config.token, baseUrl: this.config.apiUrl });

    if (this.appClient && Date.now() < this.appTokenExpiresAt) return this.appClient;
    if (!this.config.appId || !this.config.appPrivateKeyPath || !this.config.installationId) {
      throw new Error("Incomplete GitHub App configuration");
    }
    const auth = createAppAuth({
      appId: this.config.appId,
      privateKey: readFileSync(this.config.appPrivateKeyPath, "utf8"),
      installationId: this.config.installationId,
      baseUrl: this.config.apiUrl,
    });
    const installation = await auth({ type: "installation" });
    this.appClient = new Octokit({ auth: installation.token, baseUrl: this.config.apiUrl });
    this.appTokenExpiresAt = Date.now() + 50 * 60 * 1000;
    return this.appClient;
  }

  public async getPullRequest(
    repository: Repository,
    pullNumber: number,
  ): Promise<PullRequestSnapshot> {
    const octokit = await this.client();
    const { data } = await octokit.rest.pulls.get({
      owner: repository.owner,
      repo: repository.name,
      pull_number: pullNumber,
    });
    const files = await this.listFiles(repository, pullNumber);
    return {
      repository,
      number: pullNumber,
      title: data.title,
      body: data.body ?? "",
      headSha: data.head.sha,
      baseBranch: data.base.ref,
      draft: Boolean(data.draft),
      files,
    };
  }

  public async listFiles(repository: Repository, pullNumber: number): Promise<ReviewFile[]> {
    const octokit = await this.client();
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner: repository.owner,
      repo: repository.name,
      pull_number: pullNumber,
      per_page: 100,
    });
    return files.map((file) => ({
      path: file.filename,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
    }));
  }

  public async listTree(repository: Repository, headSha: string): Promise<GitTreeEntry[]> {
    const octokit = await this.client();
    const { data } = await octokit.rest.git.getTree({
      owner: repository.owner,
      repo: repository.name,
      tree_sha: headSha,
      recursive: "true",
    });
    return (data.tree as GitTreeEntry[]).filter(
      (entry) => entry.type === "blob" && entry.path && entry.sha,
    );
  }

  public async getBlob(
    repository: Repository,
    blobSha: string,
    maxBytes: number,
  ): Promise<string | null> {
    const octokit = await this.client();
    const { data } = await octokit.rest.git.getBlob({
      owner: repository.owner,
      repo: repository.name,
      file_sha: blobSha,
    });
    if (data.encoding !== "base64") return null;
    const buffer = Buffer.from(data.content, "base64");
    if (buffer.byteLength > maxBytes) return null;
    return buffer.toString("utf8");
  }

  public async createCommentReview(
    repository: Repository,
    pullNumber: number,
    headSha: string,
    body: string,
    comments: ReviewComment[],
  ): Promise<void> {
    const octokit = await this.client();
    await octokit.rest.pulls.createReview({
      owner: repository.owner,
      repo: repository.name,
      pull_number: pullNumber,
      commit_id: headSha,
      body,
      event: "COMMENT",
      comments: comments as never,
    });
  }
}

export type { GitTreeEntry, ReviewComment };
