export interface BacklogItem {
  number: number;
  title: string;
  labels: string[];
  url: string;
}

export interface SelectBacklogResult {
  ready: BacklogItem[];
}

export type BacklogPriorityRanker = (item: BacklogItem) => number;

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  labels: Array<string | { name?: string | null }>;
  pull_request?: unknown;
}

const OWNER_AGENT = "owner:agent";
const STATUS_QUEUED = "status:queued";
const ARCHIVED = "archived";
const DEFAULT_USER_AGENT = "zenod";

export async function selectBacklog(repo: string): Promise<SelectBacklogResult> {
  const [owner, name] = parseRepo(repo);
  const ready: BacklogItem[] = [];
  let page = 1;

  while (page <= 10) {
    const url = new URL(`https://api.github.com/repos/${owner}/${name}/issues`);
    url.searchParams.set("state", "open");
    url.searchParams.set("labels", `${OWNER_AGENT},${STATUS_QUEUED}`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers: githubHeaders() });
    if (!response.ok) {
      throw new Error(`GitHub backlog selection failed for ${repo}: ${response.status} ${await response.text()}`);
    }

    const issues = (await response.json()) as GitHubIssue[];
    ready.push(...issues.filter(isReadyIssue).map(toBacklogItem));
    if (issues.length < 100) break;
    page++;
  }

  return { ready: orderBacklogItems(ready) };
}

export function orderBacklogItems(items: BacklogItem[], priorityRank: BacklogPriorityRanker = defaultPriorityRank): BacklogItem[] {
  return [...items].sort((a, b) => priorityRank(a) - priorityRank(b) || a.number - b.number);
}

function parseRepo(repo: string): [string, string] {
  const [owner, name, extra] = repo.split("/");
  if (!owner || !name || extra) throw new Error(`Expected GitHub repo as owner/name, got '${repo}'`);
  return [encodeURIComponent(owner), encodeURIComponent(name)];
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": DEFAULT_USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function isReadyIssue(issue: GitHubIssue): boolean {
  if (issue.pull_request) return false;
  const labels = labelNames(issue);
  return labels.includes(OWNER_AGENT) && labels.includes(STATUS_QUEUED) && !labels.includes(ARCHIVED);
}

function toBacklogItem(issue: GitHubIssue): BacklogItem {
  return {
    number: issue.number,
    title: issue.title,
    labels: labelNames(issue),
    url: issue.html_url,
  };
}

function labelNames(issue: GitHubIssue): string[] {
  return issue.labels.flatMap((label) => {
    if (typeof label === "string") return [label];
    return label.name ? [label.name] : [];
  });
}

function defaultPriorityRank(_item: BacklogItem): number {
  return 0;
}
