#!/usr/bin/env python3
"""E12-S1b demo vault: the repo's tree-vault fixture plus ~700 made-up notes (people, trips,
home, books, recipes, health, money, work meetings and daily Log entries). Deterministic
(seeded), so before and after runs read the same vault. Everything here is invented.

usage: gen_vault.py <fixture dir> <out dir> [questions.json]
"""
import hashlib, random, shutil, sys
from pathlib import Path

rng = random.Random(1211)
fixture, out = Path(sys.argv[1]), Path(sys.argv[2])
if out.exists():
    shutil.rmtree(out)
shutil.copytree(fixture, out)

FIRST = "Ada Bram Cora Dario Elin Fenna Gus Hedda Ivo Juna Kasper Lio Mara Nils Odile Pim Quill Rosa Sten Tove Ugo Vera Wim Xena Yara Zeno Ines Hugo Lena Otto".split()
LAST = "Ashgrove Brightwater Calder Dunmore Ellery Fairbanks Greywell Holloway Inverne Juniper Kestrel Larkspur Merriweather Northcott Oakhurst Pemberton Quayle Redfern Sallow Thornbury Underhill Vexley Whitlock Yarrow Zennor".split()
CITIES = "Lisbon Porto Ghent Bergen Trieste Ljubljana Tallinn Valencia Lyon Bologna Krakow Galway Bruges Seville Tromso Malmo Annecy Split Turin Basel".split()
HOTELS = "Casa Alecrim|Hotel Mirante|The Wool House|Pension Ostra|Villa Lumen|Hotel Kade|The Linden Rooms|Albergo Sole|Maison Verre|Hostal Brisa".split("|")
TRADES = [("boiler", "service"), ("roof", "repair"), ("gutters", "clean"), ("chimney", "sweep"), ("windows", "reseal"), ("garden fence", "rebuild"), ("washing machine", "repair"), ("bathroom tiles", "regrout"), ("water heater", "replace"), ("front door lock", "replace"), ("solar panels", "inspect"), ("septic tank", "empty")]
BOOK_A = "Quiet Harbour|The Salt Ledger|Seven Lanterns|A Map of Small Rooms|The Clockmaker's Field|Winter Orchard|Paper Rivers|The Long Tide|Glass Meridian|Ash and Clover|The Ninth Bridge|Under the Fig Tree|The Copper Atlas|Night Garden|Fathom|The Weaving Hours|Stone Choir|Borrowed Light|The Last Ferry|North of Nowhere".split("|")
DISHES = "lentil soup|saffron risotto|fish stew|apple galette|chickpea curry|mushroom pie|lemon tart|beef ragu|miso aubergine|plum cake|pea and mint soup|stuffed peppers|seafood paella|cardamom buns|leek gratin".split("|")
PROJECTS = ["Moss Lantern", "Tide Cart", "Heron Desk", "Juniper API", "Orchard Sync"]
HEALTH = [("dentist", "Dr. Ilse Varga"), ("physio for the left knee", "Tomas Brandt"), ("eye test", "Optica Clara"), ("dermatologist", "Dr. Noor Haddad"), ("GP check-up", "Dr. Felix Amsel"), ("blood test", "Lab Norte")]

def fm(title, typ, summary, parent, extra=""):
    return f"---\ntitle: {title}\ntype: {typ}\ntags: []\ncreated: 2026-10-01\nupdated: 2026-10-20\nsummary: \"{summary}\"\nparent: \"[[{parent}]]\"\n{extra}---\n\n# {title}\n\n"

# Topic folders live under Notes/, where Zenod keeps pages (Projects, Areas, Notes) and indexes them.
TOPICS = ("People", "Trips", "Home", "Books", "Recipes", "Health", "Money", "Work")

def at(rel):
    return out / (f"Notes/{rel}" if rel.split("/")[0] in TOPICS else rel)

def write(rel, text):
    p = at(rel)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)

facts = {}  # name -> dict, used to pick the questions
months = "January February March April May June July August September October November December".split()

# People: 160 notes.
people = []
used = set()
while len(people) < 160:
    name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
    if name in used:
        continue
    used.add(name)
    rel = rng.choice(["friend from university", "cousin", "neighbour", "former colleague", "climbing partner", "my sister's partner", "accountant", "landlord", "running club friend", "godparent of my daughter"])
    bday = f"{rng.randint(1, 28)} {rng.choice(months)}"
    likes = rng.choice(["single-origin coffee", "jigsaw puzzles", "Portuguese wine", "vinyl jazz records", "orchids", "board games", "dark chocolate", "fountain pens", "bonsai", "sea swimming"])
    city = rng.choice(CITIES)
    people.append(name)
    facts[f"person:{name}"] = dict(rel=rel, bday=bday, likes=likes, city=city)
    write(f"People/{name}.md", fm(name, "person", f"{name}: {rel}, lives in {city}.", "Areas/People and family")
          + f"{name} is my {rel}. Lives in {city}. Birthday: {bday}. Loves {likes}, so that is a safe present.\n\n"
          + f"Last saw them in {rng.choice(months)} 2026 for {rng.choice(['dinner', 'a walk', 'coffee', 'a birthday', 'a concert'])}.\n")

# Trips: 80 notes.
for i in range(80):
    city, year = rng.choice(CITIES), rng.choice([2022, 2023, 2024, 2025, 2026])
    title = f"{city} trip {year}"
    if at(f"Trips/{title}.md").exists():
        continue
    hotel, nights, cost = rng.choice(HOTELS), rng.randint(2, 9), rng.randint(4, 30) * 50
    best = rng.choice(["the market hall", "a boat tour", "the old town walk", "a cooking class", "the modern art museum", "a day hike", "the night tram"])
    facts[f"trip:{title}"] = dict(hotel=hotel, nights=nights, cost=cost, best=best)
    write(f"Trips/{title}.md", fm(title, "note", f"Trip to {city} in {year}.", "Areas/Life admin")
          + f"Stayed {nights} nights at {hotel} in {city} ({year}). Total cost about {cost} euros including flights.\n\nBest part: {best}. Would go back in spring.\n")

# Home maintenance: 60 notes.
for i in range(60):
    thing, verb = rng.choice(TRADES)
    year = rng.choice([2023, 2024, 2025, 2026])
    title = f"{thing.capitalize()} {verb} {year}"
    if at(f"Home/{title}.md").exists():
        continue
    who = f"{rng.choice(FIRST)} {rng.choice(['Plumbing', 'Roofing', 'Home Services', 'and Sons', 'Repairs'])}"
    cost = rng.randint(3, 60) * 20
    facts[f"home:{title}"] = dict(who=who, cost=cost, month=rng.choice(months))
    write(f"Home/{title}.md", fm(title, "note", f"{thing} {verb} in {year}.", "Areas/Life admin")
          + f"{who} did the {thing} {verb} in {facts['home:' + title]['month']} {year}. Paid {cost} euros. Next check due in {rng.randint(1, 3)} years.\n")

# Books: 80 notes (title + volume).
for i in range(80):
    title = f"{rng.choice(BOOK_A)}" + ("" if i < 20 else f" {['II', 'III', 'IV', 'V'][i % 4]}")
    if at(f"Books/{title}.md").exists():
        continue
    author = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
    stars = rng.randint(2, 5)
    take = rng.choice(["slow start but the ending lands", "beautiful prose about the sea", "too long by a third", "the best thing I read this year", "a clever structure in three voices", "lent it to my brother"])
    facts[f"book:{title}"] = dict(author=author, stars=stars, take=take)
    write(f"Books/{title}.md", fm(title, "note", f"Book by {author}.", "Areas/Ideas and knowledge")
          + f"Author: {author}. Rating: {stars} out of 5. {take.capitalize()}.\n")

# Recipes: 15 notes.
for dish in DISHES:
    ings = rng.sample(["onion", "garlic", "smoked paprika", "cumin", "lemon zest", "bay leaf", "fresh thyme", "cream", "white wine", "ginger", "coconut milk", "butter", "parmesan", "fennel seeds"], 4)
    mins = rng.randint(3, 12) * 10
    facts[f"recipe:{dish}"] = dict(ings=ings, mins=mins)
    write(f"Recipes/{dish.capitalize()}.md", fm(dish.capitalize(), "note", f"My {dish} recipe.", "Areas/Life admin")
          + f"Takes {mins} minutes. Key ingredients: {', '.join(ings)}. Grandma's trick: rest it ten minutes before serving.\n")

# Health: 40 notes.
for i in range(40):
    what, who = rng.choice(HEALTH)
    date = f"{rng.randint(1, 28)} {rng.choice(months)} {rng.choice([2025, 2026])}"
    title = f"{what.capitalize()} {date}"
    note = rng.choice(["all fine, next visit in a year", "one filling needed", "do the exercises twice a day", "prescription changed slightly", "results normal"])
    write(f"Health/{title}.md", fm(title, "note", f"{what} with {who}.", "Areas/Life admin") + f"Saw {who} for the {what} on {date}: {note}.\n")

# Money: 40 notes.
for i in range(40):
    subject = rng.choice(["Car insurance", "Home insurance", "Pension top-up", "Electricity contract", "Mortgage review", "Tax return", "Phone plan", "Gym membership"])
    year = 2020 + i // 5
    title = f"{subject} {year}"
    if at(f"Money/{title}.md").exists():
        continue
    provider = rng.choice(["Nordvik", "Alba Mutual", "Ferro Bank", "Lumo Energy", "Cresta", "Vela Telecom"])
    amount = rng.randint(10, 200) * 5
    facts[f"money:{title}"] = dict(provider=provider, amount=amount)
    write(f"Money/{title}.md", fm(title, "note", f"{subject} for {year}.", "Areas/Life admin") + f"{subject} for {year} is with {provider}: {amount} euros a year. Renewal in {rng.choice(months)}.\n")

# Work meetings: 120 notes.
for i in range(120):
    project = rng.choice(PROJECTS)
    date = f"2026-{rng.randint(1, 10):02d}-{rng.randint(1, 28):02d}"
    title = f"{date} {project} sync"
    if at(f"Work/{title}.md").exists():
        continue
    decision = rng.choice(["ship the beta to ten testers", "move the launch two weeks", "drop the dark mode for now", "hire a part-time designer", "switch the database backups to nightly", "price at nine euros a month", "write the onboarding emails first"])
    owner = rng.choice(people)
    facts[f"work:{title}"] = dict(decision=decision, owner=owner, project=project)
    write(f"Work/{title}.md", fm(title, "note", f"{project} sync on {date}.", "Areas/Ventures and work") + f"Decided to {decision}. Owner: {owner}. Follow-up next week.\n")

# Log: 90 daily files with 3 entries each.
for d in range(150):
    day = f"2026-{(d // 28) + 7:02d}-{(d % 28) + 1:02d}"
    body = f"# {day}\n\n"
    for e in range(3):
        anchor = hashlib.sha1(f"{day}{e}".encode()).hexdigest()[:6]
        line = rng.choice([
            f"Called {rng.choice(people)} about the {rng.choice(['wedding', 'move', 'new job', 'trip plans'])}.",
            f"Idea: a {rng.choice(['podcast', 'newsletter', 'workshop'])} about {rng.choice(['memory', 'boats', 'cooking', 'gardening'])}.",
            f"Ran {rng.randint(3, 15)} km along the river.",
            f"Paid the {rng.choice(['water', 'internet', 'council tax'])} bill: {rng.randint(20, 140)} euros.",
        ])
        body += f"## {9 + e * 3:02d}:00 note ^e-{anchor}\n- source: whatsapp\n- verbatim: true\n\n> {line}\n\n"
    write(f"Log/{day}.md", body)

# Distinct facts the questions ask about (planted, so a question has one clear source).
write("Home/Spare key.md", fm("Spare key", "note", "Where the spare house key is.", "Areas/Life admin") + "The spare house key is in the blue ceramic frog under the rosemary pot by the back door. Mira next door has the second spare.\n")
write("Home/Wifi router.md", fm("Wifi router", "note", "Router reset steps.", "Areas/Infrastructure and runbooks") + "When the wifi drops, unplug the Vela router for thirty seconds, then hold the WPS button for five seconds. Support line: ask for ticket queue B.\n")
write("Notes/Car.md", fm("Car", "note", "The family car.", "Areas/Life admin") + "The car is a green 2019 Skoda Octavia estate. Next service due at 90,000 km, booked with Garage Rocha. Tyre pressure: 2.4 bar front, 2.6 bar rear.\n")
write("Projects/Boat repair/Hull paint.md", fm("Hull paint", "note", "Hull antifouling choice.", "Projects/Boat repair") + "For the hull we chose copper-free antifouling, two coats, applied by Estaleiro Douro in March 2024 for 1,150 euros.\n")
write("Projects/Cabin decision/Cabin options.md", fm("Cabin options", "note", "The three cabins compared.", "Projects/Cabin decision") + "Oakmere: lakeside, 185,000 euros, needs a new roof. Fernhill: forest plot, 162,000 euros, no road access in winter. Westcombe: near the coast, 210,000 euros, can be rented out in summer. Leaning to Westcombe for the rental yield.\n")
write("Notes/Travel insurance/Policy.md", fm("Travel insurance policy", "note", "The travel insurance we have.", "Notes/Travel insurance") + "Annual multi-trip policy with Alba Mutual, family cover, 96 euros a year, renews on 3 April. Covers winter sports only with the add-on.\n")
write("Projects/Launching Tide Cart/Pricing.md", fm("Tide Cart pricing", "note", "Tide Cart pricing decision.", "Projects/Launching Tide Cart") + "Tide Cart launches at 7 euros a month, with a 14-day free trial and no annual plan for now. Decided on 12 October 2026.\n")
write("Projects/Launching Moss Lantern/Launch channels.md", fm("Moss Lantern launch channels", "note", "Where Moss Lantern launches.", "Projects/Launching Moss Lantern") + "Moss Lantern launches on Reddit first (r/selfhosted), then X a week later. Heron Desk drafts the posts; nothing goes out without my yes.\n")
# The 20 demo questions, each with words the right answer must contain (any one of each group).
pick = random.Random(7)
def one(prefix):
    keys = sorted(k for k in facts if k.startswith(prefix))
    k = pick.choice(keys)
    return k.split(":", 1)[1], facts[k]
qs = [
    ("Where is the spare house key?", [["frog"], ["rosemary"]]),
    ("How do I reset the wifi router when it drops?", [["thirty", "30"], ["WPS"]]),
    ("What tyre pressure does the car need?", [["2.4"], ["2.6"]]),
    ("What did the Porto yards quote for the boat repair?", [["4,000", "4000", "4 000"]]),
    ("Which antifouling did we choose for the hull, and who applied it?", [["copper"], ["Douro"]]),
    ("What are the three cabin options and what do they cost?", [["Oakmere"], ["185"], ["Westcombe"]]),
    ("Which cabin am I leaning towards, and why?", [["Westcombe"], ["rent"]]),
    ("Which travel insurance do we have and when does it renew?", [["Alba"], ["3 April", "April 3"]]),
    ("How much will Tide Cart cost per month?", [["7 euros", "€7", "7 €", "seven euros", "7/month", "7 per month", "7 a month"]]),
    ("Where does Moss Lantern launch first?", [["Reddit"]]),
]
name, f = one("person:"); qs.append((f"When is {name}'s birthday?", [[f["bday"]]]))
name, f = one("person:"); qs.append((f"What would be a good present for {name}?", [[f["likes"].split()[-1]]]))
name, f = one("person:"); qs.append((f"Where does {name} live?", [[f["city"]]]))
title, f = one("trip:"); city, year = title.split(" trip "); qs.append((f"Which hotel did I stay at in {city} in {year}?", [[f["hotel"]]]))
title, f = one("trip:"); city, year = title.split(" trip "); qs.append((f"What was the best part of the {city} trip in {year}?", [[f["best"].split()[-1]]]))
title, f = one("home:"); qs.append((f"Who did the {title.rsplit(' ', 1)[0].lower()} in {title.rsplit(' ', 1)[1]} and what did it cost?", [[f["who"].split()[0]], [str(f["cost"])]]))
title, f = one("book:"); qs.append((f"What did I think of the book {title}?", [[str(f["stars"]), f["take"].split()[-1]]]))
title, f = one("recipe:"); qs.append((f"How long does my {title} take to make?", [[str(f["mins"])]]))
title, f = one("money:"); qs.append((f"Who is my {title.rsplit(' ', 1)[0].lower()} with in {title.rsplit(' ', 1)[1]} and how much is it?", [[f["provider"]], [str(f["amount"])]]))
title, f = one("work:"); qs.append((f"What did we decide at the {f['project']} sync on {title.split()[0]}?", [[f["decision"].split()[-1]]]))
import json
(Path(sys.argv[3]) if len(sys.argv) > 3 else out.parent / "questions.json").write_text(json.dumps([{"q": q, "expect": e} for q, e in qs], indent=2))
n = sum(1 for _ in out.rglob("*.md"))
print(f"{n} markdown files in {out}")
