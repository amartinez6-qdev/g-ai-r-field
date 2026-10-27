# G-AI-R-Field

Self-hosted GitHub pull request reviewer that uses a small local repository RAG and OmniRoute as an OpenAI-compatible LLM gateway.

The name means:

- **G** — Garfield/GitHub cat.
- **AI** — AI agent.
- **R** — reviewer.
- **Field** — focused review of specific lines and repository components.

## What the MVP does

- Receives `pull_request` webhooks for opened and updated PRs.
- Reads the PR diff and selected repository documentation.
- Indexes repository conventions locally with SQLite FTS5.
- Sends the review context to OmniRoute.
- Publishes a GitHub `COMMENT` review with inline findings and a summary.
- Never approves, blocks, merges, executes repository code, or runs tests.

## Requirements

- Node.js 22+ for direct development, or Docker Desktop.
- A GitHub fine-grained PAT or GitHub App.
- OmniRoute running locally with at least one configured provider.
- A public HTTPS URL for the webhook. Cloudflare Quick Tunnel is suitable for development.

## Repositories per service

`owner/project` is only a placeholder. One G-AI-R-Field service can review multiple repositories by listing them in `reviewer.config.yml`:

```yaml
repos:
  - acme/backend
  - acme/frontend
  - personal/side-project
```

The allowlist is shared by the webhook endpoint. A webhook for a repository not listed there is acknowledged and ignored.

## Configure before going live

Use this order so the reviewer does not start with incomplete credentials:

1. Create the local files:

   ```bash
   cp .env.example .env
   cp reviewer.config.example.yml reviewer.config.yml
   ```

2. Edit `reviewer.config.yml` and replace `owner/project` with one or more real `owner/repository` names.

3. Generate a random webhook secret and put it in `.env` as `GITHUB_WEBHOOK_SECRET`. The same value must be entered in GitHub when creating the webhook.

   ```bash
   openssl rand -hex 32
   ```

4. Choose GitHub authentication:

   - Personal use: create a fine-grained PAT limited to the selected repositories, with `Metadata: read` and `Pull requests: read/write`, then set `GITHUB_TOKEN`.
   - GitHub App: set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` and `GITHUB_INSTALLATION_ID` instead.

5. Start only OmniRoute:

   ```bash
   docker compose up -d omniroute
   ```

   The reviewer is intentionally behind the `reviewer` Compose profile, so a plain `docker compose up -d` cannot put it live before configuration is checked.

6. Open `http://127.0.0.1:20128`, connect at least one provider, preferably a free provider, and create an inference API key. Put that key in `.env` as `OMNIROUTE_API_KEY`.

   Compose overrides `OMNIROUTE_BASE_URL` inside the reviewer container to `http://omniroute:20128/v1`; no host URL change is needed for the Docker flow.

7. Run the preflight check before starting the reviewer:

   ```bash
   docker compose --profile reviewer run --rm reviewer node dist/preflight.js
   ```

   This verifies the repository allowlist, GitHub credentials, webhook secret, OmniRoute API key and the `/v1/models` endpoint.

8. Start the reviewer:

   ```bash
   docker compose up -d reviewer
   ```

9. Start the reviewer and the automatic Quick Tunnel:

   ```bash
   docker compose --profile reviewer up -d
   ```

   Read the generated public URL from the tunnel logs:

   ```bash
   docker compose --profile reviewer logs -f cloudflared
   ```

   It will look like `https://random-name.trycloudflare.com`. Configure the GitHub App webhook as `https://random-name.trycloudflare.com/webhooks/github` and subscribe to `Pull requests`.

   The Quick Tunnel URL changes when the container is recreated. For permanent use, replace it with a named Cloudflare Tunnel and a stable hostname.

If the preflight command fails, do not create the GitHub webhook yet; fix the reported value first.

## One-repository setup and webhook runbook

This is the complete setup for one repository, for example `AMM-Quant-System/Quant-Engine`.

### 1. Allow the repository

Edit `reviewer.config.yml` and keep the exact GitHub `owner/name` value:

```yaml
repos:
  - AMM-Quant-System/Quant-Engine
```

The service can contain more than one repository, but every repository must be explicitly listed. A signed webhook from any other repository is accepted with HTTP `202` and ignored.

### 2. Prepare GitHub authentication

The webhook secret and GitHub API authentication are separate:

- `GITHUB_WEBHOOK_SECRET` authenticates requests sent by GitHub to G-AI-R-Field.
- `GITHUB_TOKEN`, or the GitHub App credentials, authenticate G-AI-R-Field when it reads the PR and publishes the review.

For GitHub App mode, install the App on the organization/repository and grant the repository permissions required by the app:

- Metadata: read-only.
- Contents: read-only.
- Pull requests: read/write.

For Docker, put the private key at `secrets/<file>.pem` and use one of these paths in `.env`:

```env
GITHUB_APP_PRIVATE_KEY_PATH=/run/secrets/<file>.pem
# or
GITHUB_APP_PRIVATE_KEY_PATH=secrets/<file>.pem
```

The Compose file mounts `./secrets` read-only. Never commit the PEM file.

### 3. Start and expose the service

Run these commands from the project directory:

```bash
docker compose up -d omniroute
docker compose --profile reviewer run --rm reviewer node dist/preflight.js
docker compose --profile reviewer up -d
docker compose --profile reviewer logs -f cloudflared
```

Copy the URL printed by `cloudflared`, for example:

```text
https://random-name.trycloudflare.com
```

Check that the service is reachable before configuring GitHub:

```bash
curl https://random-name.trycloudflare.com/healthz
```

The expected response is similar to:

```json
{ "status": "ok", "queueSize": 0 }
```

Quick Tunnel URLs are temporary. If the container is recreated and the hostname changes, update the webhook URL in GitHub.

### 4. Create the repository webhook

Open:

`AMM-Quant-System/Quant-Engine → Settings → Webhooks → Add webhook`

Use these values:

| GitHub field     | Value                                                   |
| ---------------- | ------------------------------------------------------- |
| Payload URL      | `https://random-name.trycloudflare.com/webhooks/github` |
| Content type     | `application/json`                                      |
| Secret           | The exact value of `GITHUB_WEBHOOK_SECRET`              |
| SSL verification | Enabled                                                 |
| Events           | Individual events → Pull requests                       |
| Active           | Enabled                                                 |

For the MVP, select these pull-request actions:

- Opened
- Reopened
- Synchronize (GitHub UI label; configuration value is `synchronize`)
- Ready for review (configuration value is `ready_for_review`)

Commit comments are not required. The service may receive other selected pull-request actions, but it ignores them unless they are present in `reviewer.config.yml`.

Click **Add webhook**, then use **Recent Deliveries → Redeliver** on a real `pull_request` delivery. A `ping` delivery only verifies connectivity and does not start a review.

### 5. Test with a real pull request

1. Create a branch in `AMM-Quant-System/Quant-Engine`.
2. Make a small code change and open a PR.
3. GitHub sends a `pull_request` event with action `opened`.
4. G-AI-R-Field verifies the signature and checks the repository allowlist.
5. The webhook returns `202` immediately and places the PR in the local queue.
6. The worker reads the PR diff and repository context (`AGENTS.md`, `README.md`, `docs/**`, `.github/**`, and configured files).
7. The diff and retrieved context are sent to the selected OmniRoute model.
8. G-AI-R-Field publishes a `COMMENT` review with a summary and high-confidence inline findings.

Push another commit to the same PR to test `synchronize`. Marking a draft PR as ready tests `ready_for_review`. Draft PRs are ignored while `review.drafts: false`.

Watch both services while testing:

```bash
docker compose --profile reviewer logs -f reviewer cloudflared
```

### Webhook troubleshooting

- `401 Invalid webhook signature`: the GitHub webhook Secret and `GITHUB_WEBHOOK_SECRET` do not match, or the payload was changed by a proxy.
- `202` with `ignored: true`: check the repository name, event action, draft status, and `reviewer.config.yml`.
- Delivery succeeds but no review appears: inspect the `reviewer` logs for GitHub permissions, OmniRoute errors, or an invalid model response.
- `healthz` works but GitHub cannot deliver: verify the public URL, `/webhooks/github` suffix, TLS verification, and that `cloudflared` is running.
- The review is duplicated: do not manually redeliver the same delivery unless testing; the local SQLite store deduplicates the same repository, PR number, and head SHA.

## Direct development

```bash
npm install
cp .env.example .env
cp reviewer.config.example.yml reviewer.config.yml
# Edit .env and reviewer.config.yml, then start OmniRoute separately.
npm run check:config
npm run dev
```

The service listens on `http://127.0.0.1:8787`.

## Docker Compose

Follow the [configuration sequence above](#configure-before-going-live). The first `docker compose up` should start only OmniRoute; start the reviewer after `docker compose run --rm reviewer node dist/preflight.js` passes.

OmniRoute is available at `http://127.0.0.1:20128`.

The reviewer is available at `http://127.0.0.1:8787/healthz`.

## GitHub credentials

### Fine-grained PAT

For personal use, create a fine-grained token limited to the target repositories with:

- Metadata: read-only.
- Pull requests: read and write.

Set it as `GITHUB_TOKEN`.

### Repository webhook mode

G-AI-R-Field also supports a webhook created directly on each repository. This is valid when GitHub App authentication is used: the webhook delivery and the GitHub API credentials are separate concerns.

Create the webhook at `Repository → Settings → Webhooks → Add webhook` with:

- URL: `https://YOUR-TUNNEL/webhooks/github`.
- Content type: `application/json` — do not use `application/x-www-form-urlencoded`.
- Secret: the same value as `GITHUB_WEBHOOK_SECRET`.
- SSL verification: enabled.
- Individual events:
  - Pull requests: `opened`, `reopened`, `synchronized`, `ready for review`.

Commit comments are not needed for the MVP and can remain disabled. Other pull request actions may be enabled, but the reviewer will ignore actions not listed in `events` in `reviewer.config.yml`.

After saving, use `Recent Deliveries` to redeliver a real `pull_request` event. A `ping` delivery only checks connectivity; it does not start a review.

### GitHub App

Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` and `GITHUB_INSTALLATION_ID` instead of `GITHUB_TOKEN`. The App needs:

- Metadata: read-only.
- Contents: read-only, to read the repository tree and documentation blobs.
- Pull requests: read and write, to read diffs and publish reviews.

Install the App on the enterprise, organization or repositories that contain the PRs. The installation ID is the numeric ID at the end of the installation URL. GitHub documents that an App installation receives a short-lived installation token from the App ID, private key and installation ID. ([GitHub App private keys](https://docs.github.com/en/enterprise-cloud@latest/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps))

For direct host development:

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/absolute/path/to/app.private-key.pem
GITHUB_INSTALLATION_ID=12345678
GITHUB_API_URL=https://api.github.com
```

For Docker Compose, place the PEM file under the ignored `secrets/` directory and use the path inside the container:

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/run/secrets/my-reviewer-app.pem
GITHUB_INSTALLATION_ID=12345678
GITHUB_API_URL=https://api.github.com
```

The Compose file mounts `./secrets` read-only at both `/run/secrets` and `/app/secrets`, so either of these paths works in `.env`:

```env
GITHUB_APP_PRIVATE_KEY_PATH=/run/secrets/my-reviewer-app.pem
# or, relative to the project directory:
GITHUB_APP_PRIVATE_KEY_PATH=secrets/my-reviewer-app.pem
```

Never commit the PEM file.

If this is GitHub Enterprise Server with a custom hostname, set the REST API base URL instead:

```env
GITHUB_API_URL=https://github.example.com/api/v3
```

If it is GitHub Enterprise Cloud using the normal `github.com` host, keep `GITHUB_API_URL=https://api.github.com`.

## Local RAG

By default the index includes:

- `AGENTS.md` files, including nested files relevant to changed paths;
- `README.md` and `CONTRIBUTING.md`;
- `docs/**` and `.github/**`;
- common manifests and build/test configuration when explicitly added to `context.include`.

Secrets, `.env` files, generated folders, dependencies and binary files are excluded. The index is keyed by repository and PR head SHA, so the same commit is not indexed twice.

The retrieved context is used silently. G-AI-R-Field does not expose the internal prompt or context fragments in the review comment.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

For an end-to-end smoke test for one repository:

1. Put only the target repository in `reviewer.config.yml`, for example `AMM-Quant-System/Quant-Engine`.
2. Run the preflight and start `reviewer cloudflared`.
3. Configure the GitHub App webhook with the generated tunnel URL.
4. Create a branch in the target repository and open a small PR.
5. Check the App's webhook delivery in GitHub and the reviewer logs:

   ```bash
   docker compose --profile reviewer logs -f reviewer cloudflared
   ```

6. Push a second commit to the same PR to test the `synchronize` event.

## Privacy and cost

The reviewer, database and index run locally. The PR diff and selected documentation are sent to whichever provider OmniRoute chooses. Free provider quotas, availability and retention policies are controlled by those providers; do not use this setup for sensitive code until their terms are acceptable.

Keep only free providers connected in OmniRoute if zero-cost operation is required. `model: auto` does not itself guarantee that a provider is free.
