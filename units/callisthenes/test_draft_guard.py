"""Unit tests for the C-22 drafts-never-send guard. No network / fastmcp / creds."""

import pytest

from draft_guard import (
    DraftGuard,
    SendNotApproved,
    guard_from_env,
)


def test_unapproved_send_is_blocked():
    g = DraftGuard()
    with pytest.raises(SendNotApproved):
        g.check("createPosts", {"text": "hello world"})


def test_approved_send_is_allowed_and_strips_approval_arg():
    g = DraftGuard()
    forwarded = g.check(
        "createPosts", {"text": "hello world", "callisthenes_approve": True}
    )
    # allowed, and the approval flag never leaks to the upstream X request
    assert forwarded == {"text": "hello world"}
    assert "callisthenes_approve" not in forwarded


def test_falsey_approval_is_blocked():
    g = DraftGuard()
    for bad in (False, "no", "0", "", None):
        with pytest.raises(SendNotApproved):
            g.check("createPosts", {"text": "x", "callisthenes_approve": bad})


def test_non_guarded_read_tool_passes_through_untouched():
    g = DraftGuard()
    args = {"query": "from:me"}
    assert g.check("searchPostsRecent", args) == args


def test_all_default_send_ops_are_guarded():
    g = DraftGuard()
    for tool in ("createPosts", "deletePosts", "mediaUpload"):
        assert g.is_guarded(tool)
        with pytest.raises(SendNotApproved):
            g.check(tool, {})


def test_shared_token_mode_requires_exact_match():
    g = DraftGuard(approve_token="s3cret")
    with pytest.raises(SendNotApproved):
        g.check("createPosts", {"callisthenes_approve": True})  # truthy != token
    with pytest.raises(SendNotApproved):
        g.check("createPosts", {"callisthenes_approve": "wrong"})
    ok = g.check("createPosts", {"text": "hi", "callisthenes_approve": "s3cret"})
    assert ok == {"text": "hi"}


def test_custom_approve_arg():
    g = DraftGuard(approve_arg="ok_to_send")
    with pytest.raises(SendNotApproved):
        g.check("createPosts", {"callisthenes_approve": True})  # wrong arg name
    assert g.check("createPosts", {"ok_to_send": "yes"}) == {}


def test_guard_from_env_wires_knobs():
    g = guard_from_env(
        {
            "CALLISTHENES_APPROVE_TOKEN": "tok",
            "CALLISTHENES_APPROVE_ARG": "go",
            "CALLISTHENES_GUARDED_TOOLS": "createPosts",
        }
    )
    assert g.approve_arg == "go"
    assert g.approve_token == "tok"
    assert g.is_guarded("createPosts")
    assert not g.is_guarded("deletePosts")
    assert g.check("createPosts", {"go": "tok"}) == {}
