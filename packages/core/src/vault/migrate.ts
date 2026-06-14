import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_PATH } from "./config.js";

const DEFAULT_CONFIG = `schema_version: 1
tags:
  - insurance
  - vehicle
  - travel
  - health
  - housing
  - finance
  - family
  - legal
  - work
  - projects
  - ai
  - infrastructure
  - reference
confidence_threshold: 0.7
`;

const AREA_TEMPLATE = `---
title: "{{title}}"
type: area
tags: []
created: "{{date}}"
updated: "{{date}}"
summary: ""
description: ""
timestamp: "{{date}}T00:00:00Z"
---

# {{title}}
`;

const AREAS_INDEX = `# Areas Index

Ongoing life domains without a finish line — vehicle, insurance, taxes, travel, health, housing, finance, family, legal/admin.
`;

const OKF_INDEX = `---
okf_version: "0.1"
---

# Zenod Vault

This vault is a Zenod profile of Open Knowledge Format (OKF): markdown concept pages with YAML frontmatter, plus Zenod's stricter evidence, citation, lint, and git-audit guarantees.

## Concepts

- [Projects](Projects/) - finite work and outcomes.
- [Areas](Areas/) - ongoing life domains.
- [Notes](Notes/) - reusable knowledge.

## Evidence

- [Log](Log/) - append-only evidence receipts.
- [_attachments](_attachments/) - write-once source artifacts.
`;

/**
 * Schema v1 migration (docs/M0-SPEC.md § Concurrency & git contract):
 * adds .brain/config.yml, Areas/, and templates to an existing simple vault.
 * Idempotent and additive only — never touches existing files. Returns the
 * list of files it created (empty = vault already conformant).
 */
export async function ensureSchemaV1(vaultPath: string): Promise<string[]> {
  const created: string[] = [];

  const candidates: Array<[string, string]> = [
    [CONFIG_PATH, DEFAULT_CONFIG],
    ["index.md", OKF_INDEX],
    ["Areas/Areas Index.md", AREAS_INDEX],
    ["_templates/Area.md", AREA_TEMPLATE],
  ];

  for (const [relPath, content] of candidates) {
    const absolute = join(vaultPath, relPath);
    const exists = await access(absolute).then(() => true).catch(() => false);
    if (exists) continue;
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
    created.push(relPath);
  }

  return created;
}
