import type { SeedNode } from "../../src/vault/treeSeed.js";

/**
 * A made-up level-1 tree for tests (E9-5k): the roots of fixtures/tree-vault/Tree.md.
 * Zenod ships no topics of its own (EPIC-9 L-1); tests pass these to `seedTreeFiles`.
 */
export const NEUTRAL_TREE: readonly SeedNode[] = [
  { name: "Launching Moss Lantern", kind: "working", path: "Projects/Launching Moss Lantern.md",
    summary: "Getting Moss Lantern out: the idea→draft→approved→posted pipeline, post topics, Heron Desk, the Moss Lantern brand, the Reddit and X launch and testers." },
  { name: "Launching Tide Cart", kind: "working", path: "Projects/Launching Tide Cart.md",
    summary: "Getting Tide Cart to paying users: the alpha launch, a cart that tracks itself, production health and positioning." },
  { name: "Boat repair", kind: "working", path: "Projects/Boat repair.md",
    summary: "Deciding on a boat repair: the options dossier and 2023 Porto quotes; open on budget, yard and timing." },
  { name: "Cabin decision", kind: "working", path: "Projects/Cabin decision.md",
    summary: "Choosing where to buy a cabin: Oakmere vs Fernhill vs Westcombe, legal exposure, yield and financing, and the listings data." },
  { name: "Ventures and work", kind: "long-term", path: "Areas/Ventures and work.md",
    summary: "The businesses and projects over time: Kestrel (tax, gestorías), trading (Reef-Bot), Halyard, OpenLedger legal and the company history." },
  { name: "Ideas and knowledge", kind: "long-term", path: "Areas/Ideas and knowledge.md",
    summary: "Reusable thinking: markets and finance research, AI and agents (planning doctrine), story and positioning." },
  { name: "Infrastructure and runbooks", kind: "long-term", path: "Areas/Infrastructure and runbooks.md",
    summary: "How the machines and accounts work: the VPS fleet and incident lessons, accounts and access (GitHub, Gmail, browser)." },
  { name: "Life admin", kind: "long-term", path: "Areas/Life admin.md",
    summary: "Running life: housing in general, insurance, hardware, health and travel." },
  { name: "People and family", kind: "long-term", path: "Areas/People and family.md",
    summary: "The people in my life; private, detail stays in the notes." },
];
