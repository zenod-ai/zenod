import { createSign } from "node:crypto";
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

/** GitHub App credentials plus the tenant-specific installation selection. */

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

/** Existing GitHub App installation URL. Customers grant it repo access; they never create an app. */
export function githubAppInstallationUrl(settings: ConnectionSettings): string | null {
  const slug = settings.getRaw("github_app_slug");
  return slug ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new` : null;
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
export async function installationTokenForRepo(
  settings: ConnectionSettings,
  repo: string,
  options: { strict?: boolean } = {},
): Promise<string> {
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
    if (!found.ok) {
      if (options.strict) {
        throw new Error(
          `GitHub App is not installed on ${repo} or cannot access it (${found.status}). Install the app on that repo or configure a GitHub token.`,
        );
      }
      return installationToken(settings);
    }
    const installation = (await found.json()) as { id: number };
    const minted = await fetch(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
      method: "POST",
      headers,
    });
    if (!minted.ok) {
      if (options.strict) {
        throw new Error(`GitHub App token request for ${repo} failed (${minted.status}). Configure a GitHub token or reinstall the app.`);
      }
      return installationToken(settings);
    }
    const data = (await minted.json()) as { token: string; expires_at: string };
    tokenCache.set(cacheKey, { token: data.token, expiresAt: Date.parse(data.expires_at) });
    return data.token;
  } catch {
    if (options.strict) throw new Error(`GitHub App is not installed on ${repo} or cannot access it. Configure a GitHub token or reinstall the app.`);
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

interface GithubCommentResponse {
  body?: string | null;
}

interface GithubIssueResponse {
  html_url: string;
  labels: Array<{ name: string } | string>;
  body?: string | null;
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

async function configuredGithubTokens(settings: ConnectionSettings, repo?: string, requireRepoInstallation = false): Promise<string[]> {
  const pat = settings.getRaw("github_token");
  if (settings.hasGithubApp()) {
    if (repo && requireRepoInstallation) {
      try {
        const appToken = await installationTokenForRepo(settings, repo, { strict: true });
        return pat && pat !== appToken ? [appToken, pat] : [appToken];
      } catch (err) {
        if (pat) return [pat];
        throw err;
      }
    }
    const appToken = repo ? await installationTokenForRepo(settings, repo) : await installationToken(settings);
    return pat && pat !== appToken ? [appToken, pat] : [appToken];
  }
  if (!pat) throw new Error("GitHub token or app installation is required");
  return [pat];
}

async function githubRequest<T>(settings: ConnectionSettings, path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const requireRepoInstallation = method !== "GET" && method !== "HEAD";
  const tokens = await configuredGithubTokens(settings, repoFromPath(path), requireRepoInstallation);
  for (let index = 0; index < tokens.length; index += 1) {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tokens[index]}`,
        "User-Agent": "zenod",
        Accept: "application/vnd.github+json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
    const body = await response.text().catch(() => "");
    if (response.status === 403 && index + 1 < tokens.length) continue;
    throw new Error(`GitHub returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  throw new Error("GitHub request failed");
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

  if (input.labelsSet?.length) {
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
    const comments = await githubRequest<GithubCommentResponse[]>(settings, `${issuePath}/comments?per_page=100`);
    if (comments.some((comment) => comment.body === input.comment)) {
      operations.push("comment already present");
    } else {
      await githubRequest(settings, `${issuePath}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: input.comment }),
      });
      // E-1 edit-lane receipt: a POST that returns is not proof the comment landed.
      // Read the comments back and only report it posted once we can see it there.
      const after = await githubRequest<GithubCommentResponse[]>(settings, `${issuePath}/comments?per_page=100`);
      if (!after.some((comment) => comment.body === input.comment)) {
        throw new Error("comment POST returned but the comment was not found on read-back");
      }
      operations.push("posted comment");
    }
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
  // Reflect a terminal outcome onto the work ticket the execution was for — the
  // central exec ticket holds the run, but the work ticket is its home, so a
  // done/failed outcome (with evidence) is mirrored there. Best-effort: a missing
  // target or a comment failure never fails the state write.
  if (input.state === "done" || input.state === "failed") {
    const m = (issue.body ?? "").match(/Target:\*{0,2}\s*([\w.-]+\/[\w.-]+)#(\d+)/i);
    if (m && m[1] && m[2]) {
      const outcome = `Execution ${input.state} (${repo}#${input.executionId})${input.evidenceUrl ? ` — ${input.evidenceUrl}` : ""}${input.note ? ` — ${input.note}` : ""}`;
      await githubRequest(settings, `/repos/${repoPath(m[1])}/issues/${m[2]}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: outcome }),
      }).catch(() => {});
    }
  }
  return { repo, executionId: input.executionId, issueUrl: issue.html_url, state: input.state, changed: true };
}
