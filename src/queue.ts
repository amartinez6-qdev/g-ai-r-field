import pino, { type Logger } from "pino";
import type { GitHubClient } from "./github.js";
import type { RepositoryContext } from "./context.js";
import type { ReviewJob, Repository } from "./types.js";
import { Storage } from "./storage.js";
import { AiReviewer } from "./reviewer.js";

export class ReviewQueue {
  private readonly pending: ReviewJob[] = [];
  private processing = false;
  private readonly logger: Logger;

  public constructor(
    private readonly storage: Storage,
    private readonly github: GitHubClient,
    private readonly context: RepositoryContext,
    private readonly reviewer: AiReviewer,
    private readonly processDrafts: boolean,
    logger?: Logger,
  ) {
    this.logger = logger ?? pino();
  }

  public enqueue(job: ReviewJob): boolean {
    if (!this.storage.upsertJob(job.repository, job.pullNumber, job.headSha, job.deliveryId))
      return false;
    this.pending.push(job);
    void this.drain();
    return true;
  }

  public size(): number {
    return this.pending.length + (this.processing ? 1 : 0);
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    while (this.pending.length > 0) {
      const job = this.pending.shift()!;
      await this.process(job);
    }
    this.processing = false;
  }

  private async process(job: ReviewJob): Promise<void> {
    const { repository, pullNumber, headSha } = job;
    this.storage.setJobStatus(repository, pullNumber, headSha, "running");
    try {
      const snapshot = await this.github.getPullRequest(repository, pullNumber);
      if (snapshot.headSha !== headSha) {
        this.storage.setJobStatus(repository, pullNumber, headSha, "succeeded");
        this.enqueue({ ...job, headSha: snapshot.headSha });
        return;
      }
      if (snapshot.draft && !this.processDrafts) {
        this.storage.setJobStatus(repository, pullNumber, headSha, "succeeded");
        return;
      }
      await this.context.ensureIndexed(snapshot);
      const result = await this.reviewer.review(snapshot);
      await this.reviewer.publish(snapshot, result);
      this.storage.setJobStatus(repository, pullNumber, headSha, "succeeded");
      this.logger.info(
        {
          repository,
          pullNumber,
          headSha,
          findings: result.findings.length,
          structured: result.structured,
        },
        "Review published",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.storage.setJobStatus(repository, pullNumber, headSha, "failed", message);
      this.logger.error({ err: error, repository, pullNumber, headSha }, "Review failed");
    }
  }
}

export function jobFromWebhook(payload: Record<string, any>, deliveryId: string): ReviewJob | null {
  const fullName = payload.repository?.full_name;
  const number = payload.pull_request?.number;
  const headSha = payload.pull_request?.head?.sha;
  if (typeof fullName !== "string" || typeof number !== "number" || typeof headSha !== "string")
    return null;
  const [owner, name] = fullName.split("/");
  if (!owner || !name) return null;
  const repository: Repository = { owner, name };
  return { repository, pullNumber: number, headSha, deliveryId };
}
