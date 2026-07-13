from pathlib import Path
import re


ROOT = Path(__file__).parent / "skill" / "callisthenes"
SKILL = ROOT / "SKILL.md"


def _parts() -> tuple[str, str]:
    text = SKILL.read_text(encoding="utf-8")
    match = re.fullmatch(r"---\n(.+?)\n---\n(.+)", text, re.DOTALL)
    assert match, "SKILL.md must contain YAML frontmatter followed by Markdown"
    return match.group(1), match.group(2).strip()


def _scalar(frontmatter: str, name: str) -> str:
    match = re.search(rf"^{re.escape(name)}:\s*(.+)$", frontmatter, re.MULTILINE)
    assert match, f"missing {name} frontmatter"
    return match.group(1).strip()


def test_agent_skill_has_format_valid_core_metadata():
    frontmatter, body = _parts()
    name = _scalar(frontmatter, "name")
    description = _scalar(frontmatter, "description")
    assert name == ROOT.name == "callisthenes"
    assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name)
    assert len(name) <= 64
    assert 0 < len(description) <= 1024
    assert body.startswith("# Callisthenes")
    assert len(body.splitlines()) < 500


def test_agent_skill_encodes_guarded_exactly_once_workflow():
    _, body = _parts()
    required = (
        "draft_post",
        "createPosts",
        "[draft_not_approved]",
        "exact final text",
        "explicit confirmation",
        "approve_send",
        "call `approve_send` **once**",
        "https://x.com/i/web/status/<id>",
        "Never retry automatically",
        "deletePosts",
        "[throttle_exceeded]",
        "unauthorized",
    )
    for phrase in required:
        assert phrase in body


def test_agent_skill_is_portable_and_contains_no_secrets_or_fixed_tenant_url():
    all_text = "\n".join(
        path.read_text(encoding="utf-8") for path in ROOT.rglob("*") if path.is_file()
    )
    forbidden = (
        "calli.zenod.dev",
        "Authorization: Bearer",
        "X_OAUTH_CONSUMER_KEY",
        "X_OAUTH_CONSUMER_SECRET",
        "CALLISTHENES_APPROVE_TOKEN=",
    )
    for phrase in forbidden:
        assert phrase not in all_text
    assert not (ROOT / "scripts").exists()


def test_agent_skill_references_are_present_and_one_level_deep():
    _, body = _parts()
    links = re.findall(r"\]\((references/[^)]+)\)", body)
    assert links == ["references/WORKFLOW.md", "references/EXAMPLES.md"]
    for relative in links:
        path = ROOT / relative
        assert path.is_file()
        assert len(Path(relative).parts) == 2
