import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const errors: string[] = [];
  if (!config.github.token && !config.github.appId) {
    errors.push("Configure GITHUB_TOKEN or complete GitHub App credentials.");
  }
  if (config.github.appPrivateKeyPath && !existsSync(config.github.appPrivateKeyPath)) {
    errors.push(`GitHub App private key does not exist: ${config.github.appPrivateKeyPath}`);
  }
  if (!config.omniroute.apiKey) {
    errors.push("Configure OMNIROUTE_API_KEY after creating an inference key in OmniRoute.");
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const endpoint = `${config.omniroute.baseUrl.replace(/\/$/, "")}/models`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${config.omniroute.apiKey}` },
    });
  } catch (error) {
    throw new Error(
      `OmniRoute is unreachable at ${endpoint}. Start it and configure the provider before starting the reviewer. ${String(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `OmniRoute returned HTTP ${response.status} from ${endpoint}. Check OMNIROUTE_API_KEY.`,
    );
  }
  const models = (await response.json()) as { data?: unknown[] };
  const modelCount = Array.isArray(models.data) ? models.data.length : 0;
  console.log(`G-AI-R-Field configuration is ready for ${config.repos.length} repository(s).`);
  console.log(`OmniRoute is reachable and exposes ${modelCount} model(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
