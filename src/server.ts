import Fastify from "fastify";
import pino from "pino";
import type { AppConfig } from "./types.js";
import { GitHubClient } from "./github.js";
import { RepositoryContext } from "./context.js";
import { Storage } from "./storage.js";
import { AiReviewer } from "./reviewer.js";
import { ReviewQueue, jobFromWebhook } from "./queue.js";
import { isAllowedRepository, verifyWebhookSignature } from "./security.js";

export type AppDependencies = {
  storage: Storage;
  github: GitHubClient;
  context: RepositoryContext;
  reviewer: AiReviewer;
  queue: ReviewQueue;
};

export function buildServer(config: AppConfig, dependencies: AppDependencies) {
  const app = Fastify({ loggerInstance: pino({ level: process.env.LOG_LEVEL ?? "info" }) });
  app.decorateRequest("rawBody", undefined);
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const rawBody = body as string;
    try {
      (_request as typeof _request & { rawBody?: string }).rawBody = rawBody;
      done(null, JSON.parse(rawBody));
    } catch {
      done(new Error("Invalid JSON"));
    }
  });

  app.get("/", async () => ({ name: "G-AI-R-Field", status: "ok" }));
  app.get("/healthz", async () => ({ status: "ok", queueSize: dependencies.queue.size() }));

  app.post("/webhooks/github", async (request, reply) => {
    const signature = request.headers["x-hub-signature-256"];
    const event = request.headers["x-github-event"];
    const deliveryId = request.headers["x-github-delivery"];
    const rawBody = request.rawBody ?? JSON.stringify(request.body);
    if (
      typeof signature !== "string" ||
      !verifyWebhookSignature(rawBody, signature, config.github.webhookSecret)
    ) {
      return reply.code(401).send({ error: "Invalid webhook signature" });
    }
    if (typeof event !== "string" || typeof deliveryId !== "string") {
      return reply.code(400).send({ error: "Missing GitHub webhook headers" });
    }
    if (event !== "pull_request") return reply.code(202).send({ accepted: true, ignored: true });

    const payload = request.body as Record<string, any>;
    const repository = payload.repository?.full_name;
    const action = payload.action;
    if (typeof repository !== "string" || typeof action !== "string") {
      return reply.code(400).send({ error: "Malformed pull_request payload" });
    }
    if (!isAllowedRepository(repository, config.repos)) {
      return reply.code(202).send({ accepted: true, ignored: true });
    }
    if (!config.events.includes(action))
      return reply.code(202).send({ accepted: true, ignored: true });
    if (payload.pull_request?.draft && !config.review.drafts) {
      return reply.code(202).send({ accepted: true, ignored: true });
    }

    const job = jobFromWebhook(payload, deliveryId);
    if (!job) return reply.code(400).send({ error: "Malformed pull request payload" });
    const enqueued = dependencies.queue.enqueue(job);
    return reply.code(202).send({ accepted: true, enqueued });
  });

  app.addHook("onClose", async () => {
    dependencies.storage.close();
  });
  return app;
}
