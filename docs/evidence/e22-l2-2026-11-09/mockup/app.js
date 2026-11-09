// E22-L2 mockup round 2 (from E22-L1): Zenod as the librarian of your memory. Static, no server: every reply is written
// here by hand with invented example memories. One box; Zenod picks a mode and labels the reply;
// tap the label to redo the same message in another mode.
(function () {
  const MODES = {
    keep: { label: "Kept", verb: "Keep it", hint: "File it and say where" },
    lookup: { label: "Looked up", verb: "Look it up", hint: "The exact memory, with its source" },
    talk: { label: "Talking", verb: "Talk it over", hint: "Talk it through with a persona" },
    job: { label: "Job sent", verb: "Make it a job", hint: "Send a job to the memory desk" },
  };
  const ORDER = ["keep", "lookup", "talk", "job"];

  // Each example message has a reply for every mode, so a tap on the label shows the switch.
  const EXAMPLES = [
    {
      id: "who",
      text: "who are you?",
      direct: true,
      replies: {
        direct:
          "<p>I'm Zenod, the librarian of your memory. The library is yours: your notes, voice notes and files. I look after it.</p>" +
          "<p>Tell me something and I <b>keep</b> it and say where it went. Ask and I <b>look it up</b> and show the source. Want to think out loud? We <b>talk it over</b>. Something to sort out? I make it a <b>job</b> for the memory desk.</p>" +
          "<p class='z-quiet'>You never pick. I pick, I say which, and you can tap the label to change it.</p>",
      },
    },
    {
      id: "keep",
      text: "Ana's birthday is 14 March. She wants the blue notebook from the shop on Verdi street.",
      mode: "keep",
      replies: {
        keep:
          "<p>Kept. Filed under <a class='z-path'>People › Ana</a>, next to her other notes.</p>" +
          "<div class='z-card'><div class='z-card-k'>New memory · today</div><div class='z-card-t'>Ana's birthday is 14 March: wants the blue notebook, shop on Verdi street</div></div>",
        lookup:
          "<p>I found nothing saying this yet. Your closest memory: <a class='z-path'>People › Ana</a> has her phone number and the 2025 dinner at Can Pep, no birthday.</p>",
        talk:
          "<p><b>Weekly recap:</b> You've written about Ana four times this year, always around plans you made for her. Do you want to talk about the birthday, or about Ana?</p>",
        job:
          "<p>Job sent to the memory desk: <i>“Add Ana's birthday and gift idea, and remind me a week before.”</i> The result lands in your Inbox.</p>",
      },
    },
    {
      id: "lookup",
      text: "What did the plumber quote for the bathroom?",
      mode: "lookup",
      replies: {
        lookup:
          "<p><b>€1,840</b>, tiles included, from Marc Vidal on 3 October. He said he could start on the 20th.</p>" +
          "<div class='z-card z-src'><div class='z-card-k'>Source · voice note, 3 Oct · 0:48</div><div class='z-card-t'>“…so all in, with the tiles, eighteen forty. I can start the twentieth if you confirm by Friday.”</div><a class='z-path'>Home › Bathroom renovation</a></div>" +
          "<div class='z-used'>Used 2 memories · <a class='z-golit' data-lit='Bathroom'>see them lit up in the graph</a></div>",
        keep:
          "<p>Kept your question as a note in <a class='z-path'>Home › Bathroom renovation</a>. (It is a question, so you probably wanted Look up.)</p>",
        talk:
          "<p><b>Weekly recap:</b> Three quotes in five weeks, and each time you wrote “too much” and then didn't reply. €1,840 is the lowest so far. What is really holding the bathroom back?</p>",
        job:
          "<p>Job sent to the memory desk: <i>“Put all bathroom quotes side by side.”</i> The result lands in your Inbox.</p>",
      },
    },
    {
      id: "talk",
      text: "Let's talk about my running this year. I feel I've gone backwards.",
      mode: "talk",
      persona: "Weekly recap",
      replies: {
        talk:
          "<p><b>Weekly recap:</b> I read your 41 running notes from this year. You haven't gone backwards; you changed what you were running for.</p>" +
          "<ul><li><b>A pattern:</b> January to April were all times and distances. Since June it's “cleared my head”, “ran with Pau”.</li>" +
          "<li><b>A tension:</b> you signed up for the half marathon in May, and every note since says you dread the training plan.</li>" +
          "<li><b>What changed:</b> the long Sunday run became two short ones after the knee in July.</li></ul>" +
          "<p>Which bothers you more: the slower times, or that you stopped enjoying the plan?</p>" +
          "<div class='z-used'>Read from <a class='z-path'>Health › Running</a> and 6 other places · <a>see the notes</a></div>",
        lookup:
          "<p>Your fastest 10 km this year: 52:10 on 9 March. Most recent: 57:40 on 2 November.</p>" +
          "<div class='z-card z-src'><div class='z-card-k'>Source · note, 2 Nov</div><div class='z-card-t'>“57:40, legs heavy, nice with Pau though”</div><a class='z-path'>Health › Running</a></div>",
        keep:
          "<p>Kept. Filed under <a class='z-path'>Health › Running</a>: “feels like I've gone backwards this year”.</p>",
        job:
          "<p>Job sent to the memory desk: <i>“Make a running timeline for this year.”</i> The result lands in your Inbox.</p>",
      },
    },
    {
      id: "job",
      text: "Untangle my notes on the two flats we saw, Gràcia and Sant Antoni. They're all mixed up.",
      mode: "job",
      replies: {
        job:
          "<p>Job sent to the memory desk: <i>“Untangle the Gràcia and Sant Antoni flat notes.”</i> It will split the 14 notes into one folder per flat and flag the ones it can't place.</p>" +
          "<div class='z-card'><div class='z-card-k'>In your Inbox · working</div><div class='z-card-t'>Untangle the two flats</div><a class='z-path z-goinbox'>Open the Inbox</a></div>",
        lookup:
          "<p>14 notes mention a flat since 20 October. Most mix both: <i>“the bright one had the bigger kitchen but Sant Antoni's was cheaper…”</i></p>" +
          "<a class='z-path'>Home › Flat hunt</a>",
        keep:
          "<p>Kept as a note in <a class='z-path'>Home › Flat hunt</a>. (Sorting it out is a job; tap the label to send it to the desk.)</p>",
        talk:
          "<p><b>Weekly recap:</b> Reading the notes, you sound happier in every Gràcia one, and every Sant Antoni one is about price. Is the choice already made?</p>",
      },
    },
  ];

  const PERSONAS = [
    { name: "Weekly recap", on: true, often: "Sundays", about: "Reads what changed in your memory this week and tells you what stands out." },
    { name: "Open loops finder", on: true, often: "nightly", about: "Finds things you said you would do and never closed." },
    { name: "People and follow-ups", on: true, often: "every 2 days", about: "Notices people you meant to get back to." },
    { name: "Topic gardener", on: true, often: "nightly", about: "Tidies your topics: merges what belongs together, files loose notes." },
    { name: "Ideas digest", on: false, often: "", about: "Gathers the ideas you dropped in passing." },
    { name: "Health of your memory", on: true, often: "weekly", about: "Checks sources still open and flags quiet corners." },
  ];

  const $ = (s, el = document) => el.querySelector(s);
  const log = $("#z-log");
  const input = $("#z-input");
  let talkingWith = null;
  let n = 0;

  function bubbleMe(text) {
    const d = document.createElement("div");
    d.className = "z-me";
    d.textContent = text;
    log.appendChild(d);
  }

  function chip(mode) {
    return `<button class="z-chip z-${mode}" data-mode="${mode}" aria-haspopup="menu">${MODES[mode].label}<span aria-hidden="true">▾</span></button>`;
  }

  function renderReply(wrap, ex, mode) {
    wrap.dataset.mode = mode;
    const head = ex.direct
      ? `<span class="z-direct">Answered directly</span>`
      : chip(mode) + (mode === "talk" ? `<span class="z-who">with ${ex.persona || "Weekly recap"}</span>` : "");
    wrap.innerHTML = `<div class="z-head">${head}</div><div class="z-body">${ex.replies[mode]}</div>`;
    if (mode === "talk") setTalking(ex.persona || "Weekly recap");
  }

  function addReply(ex, mode) {
    const wrap = document.createElement("div");
    wrap.className = "z-reply";
    wrap.dataset.ex = ex.id;
    renderReply(wrap, ex, mode);
    log.appendChild(wrap);
    return wrap;
  }

  function scrollDown() {
    const sc = $("#z-scroll");
    sc.scrollTop = sc.scrollHeight;
  }

  // The switch menu: tap a label, pick another mode, the same message is redone that way.
  const menu = $("#z-menu");
  let menuFor = null;
  function openMenu(btn) {
    const wrap = btn.closest(".z-reply");
    menuFor = wrap;
    const cur = wrap.dataset.mode;
    menu.innerHTML =
      `<div class="z-menu-k">Do it another way</div>` +
      ORDER.map(
        (m) =>
          `<button role="menuitem" data-to="${m}" ${m === cur ? "aria-current='true'" : ""}><b>${MODES[m].verb}</b><span>${MODES[m].hint}</span></button>`
      ).join("");
    const r = btn.getBoundingClientRect();
    const host = $("#z-app").getBoundingClientRect();
    menu.style.left = Math.min(r.left - host.left, host.width - 250) + "px";
    menu.style.top = r.bottom - host.top + 6 + "px";
    menu.hidden = false;
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest(".z-chip");
    if (c) {
      e.stopPropagation();
      openMenu(c);
      return;
    }
    const to = e.target.closest("#z-menu [data-to]");
    if (to && menuFor) {
      const ex = findEx(menuFor.dataset.ex);
      if (to.dataset.to !== "talk" && talkingWith) endTalk();
      renderReply(menuFor, ex, to.dataset.to);
      menu.hidden = true;
      return;
    }
    if (e.target.closest(".z-goinbox")) {
      show("inbox");
      return;
    }
    if (!e.target.closest("#z-menu")) menu.hidden = true;
  });

  const custom = {};
  function findEx(id) {
    return EXAMPLES.find((x) => x.id === id) || custom[id];
  }

  // Talking: the box becomes a reply to the persona until you end the talk.
  function setTalking(name) {
    talkingWith = name;
    $("#z-talkbar").hidden = false;
    $("#z-talkname").textContent = name;
    input.placeholder = `Reply to ${name}…`;
  }
  function endTalk() {
    talkingWith = null;
    $("#z-talkbar").hidden = true;
    input.placeholder = "Talk to your librarian";
  }
  $("#z-endtalk").addEventListener("click", endTalk);

  // A rough stand-in for Zenod's pick, so typed messages get a label in the mockup.
  function pick(text) {
    const t = text.toLowerCase();
    if (/who are you|what are you|what do you do/.test(t)) return "direct";
    if (talkingWith) return "talk";
    if (/\b(untangle|tidy|sort out|clean up|merge|organi[sz]e|split|reorgani)/.test(t)) return "job";
    if (/\b(talk|think|feel|why do i|pattern|let's discuss|help me see)\b/.test(t)) return "talk";
    if (/\?$|^(what|when|where|who|how|which|did|do|is|was)\b/.test(t)) return "lookup";
    return "keep";
  }
  function invent(text, mode) {
    const id = "c" + ++n;
    const quote = text.length > 70 ? text.slice(0, 70) + "…" : text;
    const ex = {
      id,
      text,
      persona: talkingWith || "Weekly recap",
      direct: mode === "direct",
      replies: {
        direct: EXAMPLES[0].replies.direct,
        keep: `<p>Kept. Filed under <a class='z-path'>Inbox › To sort</a> until I know where it belongs: “${esc(quote)}”.</p>`,
        lookup: `<p class='z-quiet'>In the real app this shows the exact memory and its source. In this mockup there is nothing to look up for “${esc(quote)}”.</p>`,
        talk: `<p><b>${talkingWith || "Weekly recap"}:</b> <span class='z-quiet'>(In the real app the persona reads into your memory and answers. This mockup only shows where the reply goes.)</span></p>`,
        job: `<p>Job sent to the memory desk: <i>“${esc(quote)}”</i>. The result lands in your Inbox.</p>`,
      },
    };
    custom[id] = ex;
    return ex;
  }
  function esc(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  $("#z-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    bubbleMe(text);
    const mode = pick(text);
    const ex = invent(text, mode);
    addReply(ex, mode === "direct" ? "direct" : mode);
    scrollDown();
  });

  // Tabs.
  function show(where) {
    const [tab, sub] = where.split(":");
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
    document.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab));
    if (tab === "memory") showSub(sub || currentSub);
    if (tab === "settings") showSet(sub || currentSet);
    menu.hidden = true;
  }
  let currentSub = "glance";
  function showSub(sub) {
    currentSub = sub;
    document.querySelectorAll("[data-sub]").forEach((b) => b.setAttribute("aria-selected", b.dataset.sub === sub));
    document.querySelectorAll("[data-subpane]").forEach((p) => (p.hidden = p.dataset.subpane !== sub));
  }
  let currentSet = "connect";
  function showSet(set) {
    currentSet = set;
    document.querySelectorAll("[data-set]").forEach((b) => b.setAttribute("aria-current", b.dataset.set === set));
    document.querySelectorAll("[data-setpane]").forEach((p) => (p.hidden = p.dataset.setpane !== set));
  }
  document.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => showSub(b.dataset.sub)));
  document.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => showSet(b.dataset.set)));
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g) {
      e.preventDefault();
      show(g.dataset.go);
      if (g.closest(".pg-build")) $("#z-stage").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const l = e.target.closest(".z-golit");
    if (l) { show("memory:graph"); lightUp(["Bathroom", "Marc Vidal", "Quotes"], "Lit up: where the answer came from, the bathroom notes and the plumber's quote."); return; }
    const t = e.target.closest("[data-toast]");
    if (t) toast(t.dataset.toast);
  });
  let toastTimer;
  function toast(text) {
    const el = $("#z-toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));

  // Personas: "Talk it over" starts a talk in the chat.
  $("#z-personas").innerHTML = PERSONAS.map(
    (p) =>
      `<div class="z-persona"><div><div class="z-pname">${p.name}</div><p>${p.about}</p></div>` +
      `<div class="z-pacts"><span class="z-on">${p.on ? "On · " + p.often : "Off"}</span><button class="z-btn" data-talk="${p.name}">Talk it over</button></div></div>`
  ).join("");
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-talk]");
    if (!b) return;
    const name = b.dataset.talk;
    show("chat");
    const ex = {
      id: "p" + ++n,
      persona: name,
      replies: {
        talk: `<p><b>${name}:</b> I've read what changed in your memory this week: 23 new notes, mostly about the flat hunt and running. One thing stands out: you keep writing “after the move” about things that have nothing to do with the move. Want to start there?</p>`,
        lookup: "<p>Your newest notes this week: 23, in Home › Flat hunt (9), Health › Running (6) and 8 other places.</p>",
        keep: "<p>Nothing to keep yet: you started a talk from Personas.</p>",
        job: `<p>Job sent to the memory desk: <i>“Summarise what changed this week.”</i> The result lands in your Inbox.</p>`,
      },
    };
    custom[ex.id] = ex;
    const note = document.createElement("div");
    note.className = "z-sys";
    note.textContent = `You started a talk with ${name} from Personas`;
    log.appendChild(note);
    addReply(ex, "talk");
    scrollDown();
    input.focus();
  });

  // Frame: desktop or phone width.
  document.querySelectorAll("[data-frame]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-frame]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      $("#z-stage").dataset.frame = b.dataset.frame;
      menu.hidden = true;
    })
  );

  // Memory › At a glance: the numbers and charts.
  const WEEKS = [61, 74, 58, 90, 83, 102, 77, 96, 118, 104, 131, 23];
  (function growth() {
    const svg = $("#z-growth"), W = 360, H = 150, pad = 22, bw = (W - pad) / WEEKS.length;
    const max = 140;
    let out = "";
    [0, 70, 140].forEach((v) => {
      const y = H - 18 - (v / max) * (H - 30);
      out += `<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}" stroke="#d9d1bf"/><text x="0" y="${y + 4}" font-size="10" fill="#8d948c">${v}</text>`;
    });
    WEEKS.forEach((v, i) => {
      const h = (v / max) * (H - 30), x = pad + i * bw + 3, y = H - 18 - h;
      const last = i === WEEKS.length - 1;
      out += `<rect x="${x}" y="${y}" width="${bw - 6}" height="${h}" rx="2" fill="${last ? "#cfe0d4" : "#1f4d3a"}"><title>${v} memories</title></rect>`;
    });
    out += `<text x="${pad}" y="${H - 3}" font-size="10" fill="#8d948c">Aug</text><text x="${W - 46}" y="${H - 3}" font-size="10" fill="#8d948c">this week</text>`;
    svg.innerHTML = out;
  })();
  function hbars(el, rows) {
    const max = Math.max(...rows.map((r) => r[1]));
    $(el).innerHTML = rows.map(([k, v, show]) => `<div class="z-hb"><span class="z-hbl">${k}</span><i style="width:${(v / max) * 100}%"></i><em>${show || v}</em></div>`).join("");
  }
  hbars("#z-strong", [["Health › Running", 41], ["Work › Clients", 36], ["Home › Flat hunt", 14], ["People › Pau", 9], ["Health › Sleep", 12]].sort((a, b) => b[1] - a[1]));
  hbars("#z-sources", [["WhatsApp", 212], ["Voice notes", 141], ["This chat", 88], ["AI apps", 47], ["Telegram", 6]]);
  hbars("#z-allow", [["Filing your notes", 46, "46%"], ["Answers", 27, "27%"], ["Personas", 14, "14%"], ["Memory desk jobs", 9, "9%"], ["Voice to text", 4, "4%"]]);

  // Memory › Tree, with a note viewer.
  const TREE = [
    ["Health", [["Running", 41], ["Sleep", 12], ["Half marathon", 6]]],
    ["Home", [["Bathroom renovation", 7], ["Flat hunt › Gràcia", 7], ["Flat hunt › Sant Antoni", 5], ["To sort", 2, true]]],
    ["People", [["Ana", 5], ["Pau", 9]]],
    ["Work", [["Clients", 36], ["Ideas", 18]]],
    ["Money", [["Taxes", 11]]],
  ];
  $("#z-tree").innerHTML = TREE.map(
    ([top, kids]) => `<li>${top}<ul>${kids.map(([k, c, u]) => `<li class="z-leaf${k === "Running" ? " on" : ""}" data-leaf="${top} › ${k}" data-n="${c}">${k} <span>${c}</span>${u ? `<span class="z-unsure">needs a place</span>` : ""}</li>`).join("")}</ul></li>`
  ).join("");
  const runningNotes = $("#z-viewer .z-notes").innerHTML;
  document.addEventListener("click", (e) => {
    const leaf = e.target.closest(".z-leaf");
    if (!leaf) return;
    document.querySelectorAll(".z-leaf").forEach((x) => x.classList.toggle("on", x === leaf));
    const name = leaf.dataset.leaf.split(" › ").pop();
    $("#z-viewer .z-card-k").textContent = "Where it sits: " + leaf.dataset.leaf;
    $("#z-viewer .z-card-t").textContent = `${name} · ${leaf.dataset.n} notes`;
    $("#z-viewer .z-notes").innerHTML = name === "Running" ? runningNotes : `<li><b>this week</b> <span class="z-quiet">(the notes in ${esc(name)} show here)</span></li>`;
  });

  // Memory › Graph: places and their links; the slider hides weak links.
  const NODES = [
    ["Running", 120, 90, 16], ["Half marathon", 60, 170, 9], ["Sleep", 210, 40, 10], ["Pau", 260, 150, 11],
    ["Bathroom", 430, 80, 10], ["Marc Vidal", 520, 50, 7], ["Quotes", 540, 140, 8], ["Flat hunt", 400, 230, 12],
    ["Gràcia", 330, 300, 8], ["Sant Antoni", 480, 300, 8], ["Ana", 170, 280, 8], ["Clients", 600, 250, 14],
  ];
  const EDGES = [
    [0, 1, 5], [0, 2, 3], [0, 3, 4], [3, 10, 2], [3, 7, 3], [4, 5, 5], [4, 6, 4], [5, 6, 3], [7, 8, 5], [7, 9, 5],
    [8, 9, 2], [10, 2, 1], [4, 7, 1], [11, 6, 1], [1, 2, 2], [11, 9, 1],
  ];
  let lit = [];
  function drawGraph() {
    const min = Number($("#z-strength").value);
    $("#z-strength-v").textContent = min + "+";
    const L = (i) => lit.includes(NODES[i][0]);
    let out = EDGES.filter((e) => e[2] >= min)
      .map(([a, b, w]) => `<line x1="${NODES[a][1]}" y1="${NODES[a][2]}" x2="${NODES[b][1]}" y2="${NODES[b][2]}" stroke-width="${w * 0.6}" class="${L(a) && L(b) ? "lit" : ""}"/>`)
      .join("");
    out += NODES.map(([n, x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" data-node="${i}" class="${L(i) ? "lit" : ""}"/><text x="${x + r + 4}" y="${y + 4}" class="${L(i) ? "lit" : ""}">${n}</text>`).join("");
    $("#z-graph").innerHTML = out;
  }
  function lightUp(names, note) {
    lit = names;
    $("#z-graphnote").textContent = note;
    $("#z-graphinfo").textContent = "Home › Bathroom renovation · the plumber's voice note of 3 Oct and the tiles note";
    drawGraph();
  }
  $("#z-strength").addEventListener("input", drawGraph);
  $("#z-graph").addEventListener("click", (e) => {
    const c = e.target.closest("[data-node]");
    if (!c) return;
    const i = Number(c.dataset.node);
    const links = EDGES.filter((x) => x[0] === i || x[1] === i).map((x) => NODES[x[0] === i ? x[1] : x[0]][0]);
    $("#z-graphinfo").textContent = `${NODES[i][0]} · linked to ${links.join(", ")}`;
    document.querySelectorAll("#z-graph circle").forEach((x) => x.classList.toggle("sel", x === c));
  });
  drawGraph();
  $("#z-find").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim().toLowerCase();
    const hit = NODES.find((n) => n[0].toLowerCase().includes(q));
    show("memory:graph");
    if (hit) lightUp([hit[0]], `Found: ${hit[0]}.`);
  });

  // Memory › Check filings: the places Zenod was least sure about.
  const CHECKS = [
    ["“Ask Pau if he still has the drill”", "People › Pau", ["Home › Bathroom renovation", "People › Pau"]],
    ["“Gràcia flat: landlord prefers 2-year contract”", "Home › To sort", ["Home › Flat hunt › Gràcia", "Home › Flat hunt › Sant Antoni"]],
    ["“Book physio for the knee”", "Health › Running", ["Health › Half marathon", "Health › Running"]],
  ];
  $("#z-check").innerHTML = CHECKS.map(
    ([t, at, opts], i) =>
      `<div class="z-check" data-ci="${i}"><div class="z-card-t">${t}</div><p>Filed under <b>${at}</b> · Zenod was not sure</p>` +
      `<button class="z-btn" data-ok="${i}">Right place</button> <select data-mv="${i}" aria-label="Move it to"><option>Move it to…</option>${opts.filter((o) => o !== at).map((o) => `<option>${o}</option>`).join("")}</select></div>`
  ).join("");
  document.addEventListener("click", (e) => {
    const ok = e.target.closest("[data-ok]");
    if (!ok) return;
    ok.closest(".z-check").classList.add("done");
    ok.textContent = "Confirmed";
  });
  document.addEventListener("change", (e) => {
    const mv = e.target.closest("[data-mv]");
    if (!mv) return;
    const c = CHECKS[mv.dataset.mv];
    mv.closest(".z-check").classList.add("done");
    $("#z-moves").insertAdjacentHTML("afterbegin", `<li><span>now</span>${c[0]} moved to ${mv.value} <button class="z-link">Undo</button></li>`);
  });

  // The opening conversation: "who are you?" and one exchange per mode.
  EXAMPLES.forEach((ex) => {
    bubbleMe(ex.text);
    addReply(ex, ex.direct ? "direct" : ex.mode);
  });
  endTalk();
  const q = new URLSearchParams(location.search);
  if (q.get("frame") === "phone") document.querySelector("[data-frame=phone]").click();
  if (q.get("tab")) show(q.get("tab"));
  if (q.get("lit")) document.querySelector(".z-golit").click();
  if (q.get("menu")) {
    const c = document.querySelectorAll(".z-chip")[Number(q.get("menu"))];
    if (c) setTimeout(() => { c.scrollIntoView({ block: "center" }); openMenu(c); }, 50);
  }
})();
