import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SharedGithubApp {
  id: string;
  slug: string;
  privateKeyPem: string;
}

export function loadSharedGithubApp(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): SharedGithubApp | null {
  const id = env.ZENOD_VAULT_APP_ID?.trim();
  const slug = env.ZENOD_VAULT_APP_SLUG?.trim();
  const rawKey = env.ZENOD_VAULT_APP_PRIVATE_KEY;
  if (id && slug && rawKey) {
    return {
      id,
      slug,
      privateKeyPem: rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey,
    };
  }

  const path = env.ZENOD_SHARED_GITHUB_APP_PATH?.trim() || join(dataDir, "vault-app.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SharedGithubApp>;
    if (!parsed.id || !parsed.slug || !parsed.privateKeyPem) return null;
    return { id: String(parsed.id), slug: parsed.slug, privateKeyPem: parsed.privateKeyPem };
  } catch {
    return null;
  }
}

export function sharedGithubSettingFallbacks(app: SharedGithubApp | null): Readonly<Record<string, string>> {
  if (!app) return {};
  return {
    github_app_id: app.id,
    github_app_slug: app.slug,
    github_app_private_key: app.privateKeyPem,
  };
}
