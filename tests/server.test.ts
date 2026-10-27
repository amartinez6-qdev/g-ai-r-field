import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { buildServer } from "../src/server.js";
import { Storage } from "../src/storage.js";

const config = {
  port: 8787,
  host: "127.0.0.1",
  databasePath: ":memory:",
  repos: ["acme/project"],
  events: ["opened"],
  review: {
    model: "auto",
    drafts: false,
    maxDiffLines: 100,
    maxInlineComments: 10,
    minInlineSeverity: "medium" as const,
  },
  context: {
    enabled: true,
    maxChunks: 10,
    maxDocumentBytes: 1000,
    retainedSnapshots: 2,
    include: ["AGENTS.md"],
  },
  github: { apiUrl: "https://api.github.com", token: "token", webhookSecret: "secret" },
  omniroute: { baseUrl: "http://127.0.0.1:20128/v1", apiKey: "key", model: "auto" },
};

function payload() {
  return {
    action: "opened",
    repository: { full_name: "acme/project" },
    pull_request: {
      number: 7,
      draft: false,
      head: { sha: "abc123" },
    },
  };
}

describe("GitHub webhook server", () => {
  it("rejects invalid signatures", async () => {
    const storage = new Storage(":memory:");
    const server = buildServer(config, {
      storage,
      github: {} as never,
      context: {} as never,
      reviewer: {} as never,
      queue: { size: () => 0, enqueue: () => true } as never,
    });
    const response = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=invalid",
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-1",
      },
      payload: payload(),
    });
    expect(response.statusCode).toBe(401);
    await server.close();
  });

  it("enqueues a valid allowed pull request", async () => {
    const body = JSON.stringify(payload());
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    const storage = new Storage(":memory:");
    let enqueued = false;
    const server = buildServer(config, {
      storage,
      github: {} as never,
      context: {} as never,
      reviewer: {} as never,
      queue: {
        size: () => (enqueued ? 1 : 0),
        enqueue: () => {
          enqueued = true;
          return true;
        },
      } as never,
    });
    const response = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-2",
      },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    expect(enqueued).toBe(true);
    await server.close();
  });
});
