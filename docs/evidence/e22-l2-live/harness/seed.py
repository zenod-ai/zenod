# E22-L2 local check: a made-up demo memory (the repo's tree-vault fixture plus invented Log entries
# over twelve weeks), so the screenshots show no real note. Usage: seed.py <worktree> <data dir>
import datetime, os, random, shutil, subprocess, sys
wt, data = sys.argv[1], sys.argv[2]
vault = os.path.join(data, "tenant-demo", "vault")
shutil.rmtree(data, ignore_errors=True)
shutil.copytree(os.path.join(wt, "packages/core/test/fixtures/tree-vault"), vault)
random.seed(22)
said = [
  ("Ana's birthday", "Ana's birthday is 14 March. She wants the blue notebook from the shop on Verdi street."),
  ("Plumber quote", "The plumber quoted 1,850 euros for the bathroom, tiles not included."),
  ("Running", "Ran 6 km by the river, slower than in spring. Knee fine."),
  ("Flat hunt", "Saw the flat on Calle Sol: bright, 900 a month, landlord wants a year upfront."),
  ("Garden shed", "The shed roof leaks again on the left side. Ask Marco about felt."),
  ("Running", "Skipped the run again, third time this week, after the move everything slipped."),
  ("Book idea", "Idea: a short book on keeping notes by voice, one chapter per habit."),
  ("Boat", "Boat cover needs replacing before winter, about 300 euros."),
]
sources = ["whatsapp"] * 5 + ["web"] * 2 + ["mcp"] * 3
today = datetime.date(2026, 11, 9)
logs = {}
n = 0
for week in range(12):
    for _ in range(random.randint(2, 7) + week // 2):
        day = today - datetime.timedelta(days=7 * (11 - week) + random.randint(0, 6))
        if day > today: day = today
        title, text = random.choice(said)
        n += 1
        src = random.choice(sources)
        ctype = "voice_note" if src == "whatsapp" and n % 3 == 0 else None
        logs.setdefault(day, []).append(f"## {9 + n % 9:02d}:{n % 60:02d} {title} ^e-{0xd0000 + n:06x}\n- source: {src}\n- captured-at: {day}T{9 + n % 9:02d}:{n % 60:02d}:00Z\n" + (f"- content-type: {ctype}\n" if ctype else "") + f"- verbatim: true\n\n> {text}\n")
for day, entries in logs.items():
    path = os.path.join(vault, "Log", f"{day}.md")
    head = "" if os.path.exists(path) else f"# {day}\n\n"
    with open(path, "a") as f: f.write(head + "\n".join(entries))
for cmd in (["git", "init", "-q", "-b", "main"], ["git", "add", "-A"], ["git", "-c", "user.name=demo", "-c", "user.email=demo@example.test", "commit", "-qm", "demo memory"]):
    subprocess.run(cmd, cwd=vault, check=True)
subprocess.run(["git", "clone", "-q", "--bare", vault, os.path.join(data, "origin.git")], check=True)
subprocess.run(["git", "remote", "add", "origin", os.path.join(data, "origin.git")], cwd=vault, check=True)
print("seeded", n, "demo entries")
