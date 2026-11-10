# E14-S29 local check: a made-up memory (the repo's tree-vault fixture plus invented pages and notes),
# so the screenshots show no real note. Usage: seed.py <worktree> <data dir>
import os, shutil, subprocess, sys, json
wt, data = sys.argv[1], sys.argv[2]
vault = os.path.join(data, "tenant-demo", "vault")
shutil.rmtree(data, ignore_errors=True)
shutil.copytree(os.path.join(wt, "packages/core/test/fixtures/tree-vault"), vault)
notes = [
  ("2026-11-06", "e-a10001", "Flat in Ruzafa", "Lucía says the flat in Ruzafa is still free until the 20th and the owner accepts a one-year contract."),
  ("2026-11-04", "e-a10002", "Viewing", "Saw the flat again with Marta, bright, 900 a month. Need the bank letter for the agent."),
  ("2026-10-28", "e-a10003", "Moving boxes", "Book the van for the move to Valencia, first weekend of December."),
  ("2026-11-02", "e-a10004", "Ana's birthday", "Ana's birthday is 14 March. She wants the blue notebook from the shop on Verdi street."),
  ("2026-11-07", "e-a10005", "Cello", "Cello lesson moved to Thursdays at 6, bring the new strings."),
  ("2026-11-08", "e-a10006", "Cello", "Practised the Bach prelude for 20 minutes, the shifts are getting cleaner."),
  ("2026-11-03", "e-a10007", "Cello", "Ask Inés about a cheaper cello bow, the rented one is tired."),
]
os.makedirs(os.path.join(vault, "Log"), exist_ok=True)
for day, eid, title, text in notes:
    path = os.path.join(vault, "Log", f"{day}.md")
    head = "" if os.path.exists(path) else f"# {day}\n\n"
    with open(path, "a") as f:
        f.write(head + f"## 10:00 {title} ^{eid}\n- source: whatsapp\n- captured-at: {day}T10:00:00Z\n- verbatim: true\n\n> {text}\n\n")
def page(path, title, summary, cites, parent=None):
    full = os.path.join(vault, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    fm = f"---\ntitle: {title}\ntype: note\nsummary: \"{summary}\"\n" + (f"parent: \"[[{parent}]]\"\n" if parent else "") + "---\n\n"
    body = f"# {title}\n\n" + "\n".join(f"- {t} [[{d}#^{e}]]" for d, e, t in cites) + "\n"
    open(full, "w").write(fm + body)
page("Projects/Moving to Valencia.md", "Moving to Valencia", "Moving to Valencia: the Ruzafa flat, the agent Lucía, the van and the dates.",
     [("2026-11-06", "e-a10001", "The Ruzafa flat is free until the 20th, one-year contract."), ("2026-11-04", "e-a10002", "Second viewing, 900 a month, bank letter needed."), ("2026-10-28", "e-a10003", "Van booked for the first weekend of December.")])
page("Notes/Ana.md", "Ana", "Ana: birthday 14 March, the blue notebook.", [("2026-11-02", "e-a10004", "Birthday 14 March, wants the blue notebook.")], parent="Areas/People and family")
page("Areas/Cello lessons.md", "Cello lessons", "Cello lessons on Thursdays, the Bach prelude.", [("2026-11-07", "e-a10005", "Lessons moved to Thursdays at 6."), ("2026-11-08", "e-a10006", "Bach prelude practice."), ("2026-11-03", "e-a10007", "A cheaper bow, ask Inés.")])
tree = open(os.path.join(vault, "Tree.md")).read()
tree = tree.replace("## Working memory\n\n", "## Working memory\n\n- Moving to Valencia | working | [[Projects/Moving to Valencia]] | Moving to Valencia: the Ruzafa flat, the agent Lucía, the van and the dates.\n- Cello lessons | working | [[Areas/Cello lessons]] | Cello lessons on Thursdays, the Bach prelude.\n")
open(os.path.join(vault, "Tree.md"), "w").write(tree)
for cmd in (["git", "init", "-q", "-b", "main"], ["git", "add", "-A"], ["git", "-c", "user.name=demo", "-c", "user.email=demo@example.test", "commit", "-qm", "demo memory"]):
    subprocess.run(cmd, cwd=vault, check=True)
subprocess.run(["git", "clone", "-q", "--bare", vault, os.path.join(data, "origin.git")], check=True)
subprocess.run(["git", "remote", "add", "origin", os.path.join(data, "origin.git")], cwd=vault, check=True)
# The names DeepSeek would find in these words ("the flat"), as the live index keeps them.
state = {"version": 1, "firstBuiltAt": "2026-11-09T00:00:00Z", "builtAt": "2026-11-09T00:00:00Z", "lastNightly": None, "seen": [],
         "nicknames": {"Projects/Moving to Valencia.md": [{"name": "the flat", "from": "2026-11-06#^e-a10001", "at": "2026-11-09T00:00:00Z"}]},
         "calls": [], "corrections": {}, "summaries": {}, "summaryTried": {}}
json.dump(state, open(os.path.join(data, "tenant-demo", "quick-index.json"), "w"))
print("seeded")
