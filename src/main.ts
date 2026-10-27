import pino from "pino";
import { loadConfig } from "./config.js";
import { RepositoryContext } from "./context.js";
import { GitHubClient } from "./github.js";
import { ReviewQueue } from "./queue.js";
import { AiReviewer } from "./reviewer.js";
import { buildServer } from "./server.js";
import { Storage } from "./storage.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

async function main(): Promise<void> {
  const config = loadConfig();
  const storage = new Storage(config.databasePath);
  const github = new GitHubClient(config.github);
  const context = new RepositoryContext(github, storage, config.context);
  const reviewer = new AiReviewer(github, context, config);
  const queue = new ReviewQueue(storage, github, context, reviewer, config.review.drafts, logger);
  const server = buildServer(config, { storage, github, context, reviewer, queue });
  await server.listen({ host: config.host, port: config.port });
  logger.info(
    { host: config.host, port: config.port, repos: config.repos },
    "G-AI-R-Field started",
  );
}

main().catch((error) => {
  logger.error(error, "G-AI-R-Field failed to start");
  process.exitCode = 1;
});
