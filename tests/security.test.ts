import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { isAllowedRepository, verifyWebhookSignature } from "../src/security.js";

describe("webhook security", () => {
  it("accepts a valid GitHub SHA-256 signature", () => {
    const body = JSON.stringify({ hello: "world" });
    const secret = "test-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyWebhookSignature("{}", "sha256=invalid", "secret")).toBe(false);
  });

  it("matches repositories case-insensitively", () => {
    expect(isAllowedRepository("Acme/Project", ["acme/project"])).toBe(true);
    expect(isAllowedRepository("Acme/Other", ["acme/project"])).toBe(false);
  });
});
