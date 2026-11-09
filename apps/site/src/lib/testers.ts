// The zenod.dev/testers apply form (ZAL-A13): posts to the server, which keeps
// answers in a private file on the production data volume.
export const TESTERS_APPLY_PATH = "/api/public/testers/apply";
export const TESTERS_QUESTION = "How are you going to be using Zenod Memory?";

export async function submitTesterApplication(
  input: { use: string; contact: string; website: string },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(TESTERS_APPLY_PATH, {
    method: "POST",
    credentials: "omit",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.ok) return;
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  throw new Error(typeof payload.error === "string" ? payload.error : "Could not send your application. Please try again.");
}

