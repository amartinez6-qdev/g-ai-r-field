import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signature.slice("sha256=".length);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function isAllowedRepository(fullName: string, allowedRepositories: string[]): boolean {
  if (allowedRepositories.length === 0) return false;
  return allowedRepositories.some((allowed) => allowed.toLowerCase() === fullName.toLowerCase());
}
