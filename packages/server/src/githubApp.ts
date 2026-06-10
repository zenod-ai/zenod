import { createSign, randomBytes } from "node:crypto";
import type { Settings } from "./settings.js";

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

export function appStatus(settings: Settings): GithubAppStatus {
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
      default_permissions: { contents: "write", metadata: "read" },
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
export async function exchangeManifestCode(code: string, settings: Settings): Promise<ManifestConversion> {
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
export async function installationToken(settings: Settings): Promise<string> {
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

export interface InstallationRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

/** Repos the user granted to the installation — feeds the UI repo picker. */
export async function listInstallationRepos(settings: Settings): Promise<InstallationRepo[]> {
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

export function disconnectApp(settings: Settings): void {
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
