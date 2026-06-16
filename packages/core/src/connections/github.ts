import { createSign, randomBytes } from "node:crypto";
/**
 * The minimal settings surface the connections layer needs — decoupled from the
 * concrete server Settings class so this logic can move to a shared package and
 * be reused by other agents. The server's Settings class satisfies it
 * structurally, so existing callers pass their Settings unchanged.
 */
export interface ConnectionSettings {
  getRaw(key: string): string | null;
  setRaw(key: string, value: string): void;
  hasGithubApp(): boolean;
}

/**
 * GitHub App manifest flow — the "Connect GitHub" button. The instance walks
 * the user through creating their OWN GitHub App (one click on GitHub's side),
 * stores its credentials, and from then on mints short-lived installation
 * tokens scoped to exactly the repos the user granted. No PAT.
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */

export interface GithubAppStatus {
  created: boolean;
  installed: boolean;
  slug: string | null;
  installationId: string | null;
}

export function appStatus(settings: ConnectionSettings): GithubAppStatus {
  const slug = settings.getRaw("github_app_slug");
  const installationId = settings.getRaw("github_app_installation_id");
  return {
    created: Boolean(settings.getRaw("github_app_id") && settings.getRaw("github_app_private_key")),
    installed: Boolean(installationId),
    slug,
    installationId,
  };
}

/** The manifest the UI form-POSTs to https://github.com/settings/apps/new. */
export function buildManifest(baseUrl: string): { action: string; manifest: Record<string, unknown> } {
  const suffix = randomBytes(2).toString("hex");
  return {
    action: "https://github.com/settings/apps/new",
    manifest: {
      name: `zenod-${suffix}`,
      url: baseUrl,
      redirect_url: `${baseUrl}/api/github/app/callback`,
      setup_url: `${baseUrl}/api/github/app/setup`,
      setup_on_update: true,
      public: false,
      // contents: commit the vault. issues: manage Zenod's own central backlog
      // (create/label/queue issues on its own repo — #61). Zenod never needs
      // write to other repos; Codex (broad VPS access) handles those.
      default_permissions: { contents: "write", issues: "write", metadata: "read" },
      default_events: [],
      hook_attributes: { url: `${baseUrl}/api/github/app/hook`, active: false },
    },
  };
}

interface ManifestConversion {
  id: number;
  slug: string;
  pem: string;
  html_url: string;
}

/** Exchange the one-time manifest code for the new app's credentials. */
export async function exchangeManifestCode(code: string, settings: ConnectionSettings): Promise<ManifestConversion> {
  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", "User-Agent": "zenod" },
  });
  if (!response.ok) {
    throw new Error(`GitHub manifest conversion failed: ${response.status} ${await response.text()}`);
  }
  const app = (await response.json()) as ManifestConversion;
  settings.setRaw("github_app_id", String(app.id));
  settings.setRaw("github_app_slug", app.slug);
  settings.setRaw("github_app_private_key", app.pem);
  return app;
}

/** Compact RS256 JWT for app-level API calls — no extra dependencies. */
export function appJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): string {
  const b64 = (data: string | Buffer): string =>
    Buffer.from(data).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKeyPem);
  return `${header}.${payload}.${b64(signature)}`;
}

interface InstallationToken {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

const tokenCache = new Map<string, InstallationToken>();

/** Mint (and cache) a short-lived installation token. */
export async function installationToken(settings: ConnectionSettings): Promise<string> {
  const appId = settings.getRaw("github_app_id");
  const pem = settings.getRaw("github_app_private_key");
  const installationId = settings.getRaw("github_app_installation_id");
  if (!appId || !pem || !installationId) throw new Error("GitHub App is not fully connected");

  const cacheKey = `${appId}:${installationId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;

  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${appJwt(appId, pem)}`,
      "User-Agent": "zenod",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub installation token request failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { token: string; expires_at: string };
  tokenCache.set(cacheKey, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

/**
 * Mint a token for the installation that actually owns `repo` (owner/name), so
 * the App works across EVERY account it is installed on — not just the one
 * stored installation. Falls back to the stored single-installation token on any
 * failure, so behaviour is never worse than the previous single-repo path.
 */
export async function installationTokenForRepo(settings: ConnectionSettings, repo: string): Promise<string> {
  const appId = settings.getRaw("github_app_id");
  const pem = settings.getRaw("github_app_private_key");
  if (!appId || !pem || !repo.includes("/")) return installationToken(settings);
  const cacheKey = `repo:${repo}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;
  try {
    const jwt = appJwt(appId, pem);
    const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}`, "User-Agent": "zenod" };
    const found = await fetch(`https://api.github.com/repos/${repoPath(repo)}/installation`, { headers });
    if (!found.ok) return installationToken(settings);
    const installation = (await found.json()) as { id: number };
    const minted = await fetch(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
      method: "POST",
      headers,
    });
    if (!minted.ok) return installationToken(settings);
    const data = (await minted.json()) as { token: string; expires_at: string };
    tokenCache.set(cacheKey, { token: data.token, expiresAt: Date.parse(data.expires_at) });
    return data.token;
  } catch {
    return installationToken(settings);
  }
}

/** Parse `owner/name` from a `/repos/owner/name/...` GitHub API path. */
function repoFromPath(path: string): string | undefined {
  const match = path.match(/^\/repos\/([^/]+)\/([^/]+)/);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

export interface InstallationRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

/** Repos the user granted to the installation — feeds the UI repo picker. */
export async function listInstallationRepos(settings: ConnectionSettings): Promise<InstallationRepo[]> {
  const token = await installationToken(settings);
  const repos: InstallationRepo[] = [];
  let page = 1;
  while (page <= 10) {
    const response = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "zenod" },
    });
    if (!response.ok) throw new Error(`GitHub repository listing failed: ${response.status}`);
    const data = (await response.json()) as {
      total_count: number;
      repositories: Array<{ full_name: string; private: boolean; default_branch: string }>;
    };
    repos.push(
      ...data.repositories.map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch })),
    );
    if (repos.length >= data.total_count || data.repositories.length === 0) break;
    page++;
  }
  return repos;
}

export function disconnectApp(settings: ConnectionSettings): void {
  for (const key of [
    "github_app_id",
    "github_app_slug",
    "github_app_private_key",
    "github_app_installation_id",
  ] as const) {
    settings.setRaw(key, "");
  }
  tokenCache.clear();
}

export interface EditGithubIssueInput {
  repo?: string;
  issueNumber: number;
  title?: string;
  body?: string;
  labelsAdd?: string[];
  labelsRemove?: string[];
  labelsSet?: string[];
  comment?: string;
  assignees?: string[];
  status?: string;
  queueApproval?: boolean;
  /** Open/close the issue (GitHub state, not a label). */
  state?: "open" | "closed";
  /** Why it closed — GitHub's state_reason. Defaults to "completed" when closing. */
  stateReason?: "completed" | "not_planned" | "reopened";
}

export interface EditGithubIssueResult {
  repo: string;
  issueNumber: number;
  issueUrl: string;
  operations: string[];
  labels?: string[];
}

interface GithubIssueResponse {
  html_url: string;
  labels: Array<{ name: string } | string>;
}

type GithubLabelsResponse = Array<{ name: string } | string>;

const STATUS_PROPOSED = "status:proposed";
const STATUS_QUEUED = "status:queued";
const STATUS_APPROVED_MERGE = "status:approved-merge";
const GATED_STATUSES = new Set([STATUS_QUEUED, STATUS_APPROVED_MERGE]);

function normalizeLabelIssueLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => (GATED_STATUSES.has(label) ? STATUS_PROPOSED : label)))];
}

function repoPath(repo: string): string {
  return encodeURIComponent(repo).replace("%2F", "/");
}

function normalizeStatusLabel(status: string): string {
  const trimmed = status.trim();
  if (!trimmed) throw new Error("status cannot be blank");
  return trimmed.startsWith("status:") ? trimmed : `status:${trimmed}`;
}

function issueLabels(issue: GithubIssueResponse): string[] {
  return issue.labels.map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean);
}

function labelNames(labels: GithubLabelsResponse): string[] {
  return labels.map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean);
}

function replaceStatusLabel(labels: string[], status: string): string[] {
  const withoutStatus = labels.filter((label) => !label.startsWith("status:"));
  return [...new Set([...withoutStatus, status])];
}

/**
 * The repo issue tools act on when the caller doesn't name one: a vault agent's
 * vault repo, or (for a vaultless backlog agent like Archus) its central backlog
 * repo. Mirrors the tasking-tools default so MCP and chat agree.
 */
function defaultIssueRepo(settings: ConnectionSettings): string | null {
  return settings.getRaw("vault_repo") || settings.getRaw("backlog_repo") || null;
}

async function configuredGithubToken(settings: ConnectionSettings, repo?: string): Promise<string> {
  if (settings.hasGithubApp()) {
    return repo ? installationTokenForRepo(settings, repo) : installationToken(settings);
  }
  const token = settings.getRaw("github_token");
  if (!token) throw new Error("GitHub token or app installation is required");
  return token;
}

async function githubRequest<T>(settings: ConnectionSettings, path: string, init: RequestInit = {}): Promise<T> {
  const token = await configuredGithubToken(settings, repoFromPath(path));
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "zenod",
      Accept: "application/vnd.github+json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Mutate one GitHub issue in the configured repository. Generic label edits
 * reuse the agent-tasking policy: queue/merge-gated labels are normalized away.
 * The only exception here is status:queued with queueApproval=true for this
 * exact issue number, matching the explicit human queue gate.
 */
export async function editGithubIssue(settings: ConnectionSettings, input: EditGithubIssueInput): Promise<EditGithubIssueResult> {
  const repo = input.repo || defaultIssueRepo(settings);
  if (!repo) throw new Error("No GitHub repository is configured.");
  const issuePath = `/repos/${repoPath(repo)}/issues/${input.issueNumber}`;
  const operations: string[] = [];
  let issue = await githubRequest<GithubIssueResponse>(settings, issuePath);
  const issueUrl = issue.html_url;
  let labels = issueLabels(issue);

  if (
    input.title !== undefined ||
    input.body !== undefined ||
    input.assignees !== undefined ||
    input.state !== undefined
  ) {
    const closing = input.state === "closed";
    issue = await githubRequest<GithubIssueResponse>(settings, issuePath, {
      method: "PATCH",
      body: JSON.stringify({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.assignees !== undefined ? { assignees: input.assignees } : {}),
        ...(input.state !== undefined
          ? { state: input.state, state_reason: input.stateReason ?? (closing ? "completed" : "reopened") }
          : {}),
      }),
    });
    labels = issueLabels(issue);
    if (input.title !== undefined) operations.push("updated title");
    if (input.body !== undefined) operations.push("updated body");
    if (input.assignees !== undefined) operations.push("replaced assignees");
    if (input.state !== undefined) operations.push(closing ? "closed" : "reopened");
  }

  if (input.labelsSet) {
    labels = normalizeLabelIssueLabels(input.labelsSet);
    const labelResponse = await githubRequest<GithubLabelsResponse>(settings, `${issuePath}/labels`, {
      method: "PUT",
      body: JSON.stringify({ labels }),
    });
    labels = labelNames(labelResponse);
    operations.push("set labels");
  }

  if (input.labelsRemove?.length) {
    for (const label of input.labelsRemove) {
      await githubRequest(settings, `${issuePath}/labels/${encodeURIComponent(label)}`, { method: "DELETE" }).catch((err: unknown) => {
        if (!String((err as Error).message).includes("GitHub returned 404")) throw err;
      });
    }
    labels = labels.filter((label) => !input.labelsRemove!.includes(label));
    operations.push("removed labels");
  }

  if (input.labelsAdd?.length) {
    const toAdd = normalizeLabelIssueLabels(input.labelsAdd);
    const labelResponse = await githubRequest<GithubLabelsResponse>(settings, `${issuePath}/labels`, {
      method: "POST",
      body: JSON.stringify({ labels: toAdd }),
    });
    labels = labelNames(labelResponse);
    operations.push("added labels");
  }

  if (input.status !== undefined) {
    const requestedStatus = normalizeStatusLabel(input.status);
    if (requestedStatus === STATUS_APPROVED_MERGE) {
      throw new Error("status:approved-merge is only available through the approve_merge gate.");
    }
    if (requestedStatus === STATUS_QUEUED && !input.queueApproval) {
      throw new Error("status:queued requires explicit user approval for this numbered issue; pass queueApproval=true only after that approval.");
    }
    const nextStatus = requestedStatus === STATUS_QUEUED ? STATUS_QUEUED : normalizeLabelIssueLabels([requestedStatus])[0] ?? STATUS_PROPOSED;
    labels = replaceStatusLabel(labels, nextStatus);
    const labelResponse = await githubRequest<GithubLabelsResponse>(settings, `${issuePath}/labels`, {
      method: "PUT",
      body: JSON.stringify({ labels }),
    });
    labels = labelNames(labelResponse);
    operations.push(`set ${nextStatus}`);
  }

  if (input.comment) {
    await githubRequest(settings, `${issuePath}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: input.comment }),
    });
    operations.push("posted comment");
  }

  return {
    repo,
    issueNumber: input.issueNumber,
    issueUrl,
    operations,
    labels,
  };
}

export interface CreateGithubIssueInput {
  repo?: string;
  title: string;
  body?: string;
  labels?: string[];
}

export interface CreateGithubIssueResult {
  repo: string;
  issueNumber: number;
  issueUrl: string;
  labels: string[];
}

/**
 * Open a new GitHub issue in the configured repository — a direct, LLM-free
 * structured creation (the caller supplies title/body/labels). Created tickets
 * start at status:proposed, matching the agent-tasking create policy, so a
 * brand-new ticket never auto-runs. Defaults to the agent's issue repo.
 */
export async function createGithubIssue(settings: ConnectionSettings, input: CreateGithubIssueInput): Promise<CreateGithubIssueResult> {
  const repo = input.repo || defaultIssueRepo(settings);
  if (!repo) throw new Error("No GitHub repository is configured.");
  const labels = [...new Set([...normalizeLabelIssueLabels(input.labels ?? []), STATUS_PROPOSED])];
  const issue = await githubRequest<{ number: number; html_url: string }>(settings, `/repos/${repoPath(repo)}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      labels,
    }),
  });
  return { repo, issueNumber: issue.number, issueUrl: issue.html_url, labels };
}

// --- Execution tickets (Archus ↔ Epaminon protocol) ------------------------
// An execution ticket is a central-backlog issue, class `type:execution`, whose
// run-state lives in its own `exec:` label namespace (never collides with the
// backlog `status:` labels). See docs/ARCHUS-TWO-TIER-PLAN.md.

export const EXECUTION_CLASS_LABEL = "type:execution";
const EXEC_LABEL_PREFIX = "exec:";
/** Run-state values. Archus writes queued+approved; Epaminon reports the rest. */
export const EXECUTION_STATES = ["queued", "running", "needs-review", "approved", "blocked", "done", "failed"] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export interface MintExecutionInput {
  repo?: string;
  title: string;
  /** Run context: objective, scope, done-condition + the goal. */
  context: string;
  /** The work ticket this run is for, e.g. owner/repo#N. */
  target: string;
}
export interface ExecutionIssueResult {
  repo: string;
  executionId: number;
  issueUrl: string;
}

/**
 * Mint an execution ticket (Archus, at queue time): a central issue labelled
 * `type:execution` + `exec:queued`, linking its target work ticket and carrying
 * the run context. Unlike createGithubIssue it does NOT add status:proposed —
 * an execution ticket lives in the `exec:` lifecycle, not the backlog one.
 */
export async function mintExecutionIssue(settings: ConnectionSettings, input: MintExecutionInput): Promise<ExecutionIssueResult> {
  const repo = input.repo || defaultIssueRepo(settings);
  if (!repo) throw new Error("No GitHub repository is configured.");
  const body = `**Target:** ${input.target}\n\n${input.context}`;
  const issue = await githubRequest<{ number: number; html_url: string }>(settings, `/repos/${repoPath(repo)}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: input.title, body, labels: [EXECUTION_CLASS_LABEL, `${EXEC_LABEL_PREFIX}queued`] }),
  });
  return { repo, executionId: issue.number, issueUrl: issue.html_url };
}

export interface SetExecutionStateInput {
  repo?: string;
  executionId: number;
  state: ExecutionState;
  evidenceUrl?: string;
  note?: string;
}
export interface SetExecutionStateResult {
  repo: string;
  executionId: number;
  issueUrl: string;
  state: ExecutionState;
  /** false when the ticket was already in this state (idempotent no-op). */
  changed: boolean;
}

/**
 * Deterministically move an execution ticket's `exec:` state — the no-LLM write
 * behind `apply_execution_event`. Swaps the single `exec:*` label and (on a real
 * transition) appends the evidence/note as a comment. Idempotent: re-applying the
 * current state is a no-op (no relabel, no duplicate comment).
 */
export async function setExecutionState(settings: ConnectionSettings, input: SetExecutionStateInput): Promise<SetExecutionStateResult> {
  const repo = input.repo || defaultIssueRepo(settings);
  if (!repo) throw new Error("No GitHub repository is configured.");
  const target = `${EXEC_LABEL_PREFIX}${input.state}`;
  const issuePath = `/repos/${repoPath(repo)}/issues/${input.executionId}`;
  const issue = await githubRequest<GithubIssueResponse>(settings, issuePath);
  const labels = issueLabels(issue);
  if (labels.includes(target)) {
    return { repo, executionId: input.executionId, issueUrl: issue.html_url, state: input.state, changed: false };
  }
  const nextLabels = [...labels.filter((l) => !l.startsWith(EXEC_LABEL_PREFIX)), target];
  await githubRequest<GithubLabelsResponse>(settings, `${issuePath}/labels`, {
    method: "PUT",
    body: JSON.stringify({ labels: nextLabels }),
  });
  if (input.evidenceUrl || input.note) {
    const comment = [`**${target}**`, input.evidenceUrl, input.note].filter(Boolean).join(" — ");
    await githubRequest(settings, `${issuePath}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) });
  }
  return { repo, executionId: input.executionId, issueUrl: issue.html_url, state: input.state, changed: true };
}
