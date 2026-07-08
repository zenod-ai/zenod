"""Unit tests for the throttle limiter. No network, no fastmcp, no X creds."""

from throttle import (
    DEFAULT_PER_HOUR,
    RateLimiter,
    _parse_per_hour,
    _parse_send_tools,
    limiter_from_env,
    send_tools_from_env,
)


class FakeClock:
    def __init__(self, t: float = 0.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


def test_blocks_the_n_plus_1th_send_in_window():
    clock = FakeClock()
    rl = RateLimiter(per_hour=3, window_seconds=3600, clock=clock)
    assert rl.allow() is True   # 1
    assert rl.allow() is True   # 2
    assert rl.allow() is True   # 3
    assert rl.allow() is False  # 4th (N+1) blocked
    assert rl.remaining() == 0


def test_window_slides_and_frees_capacity():
    clock = FakeClock()
    rl = RateLimiter(per_hour=2, window_seconds=3600, clock=clock)
    assert rl.allow() is True
    assert rl.allow() is True
    assert rl.allow() is False
    # advance past the window: the two old events fall off
    clock.advance(3601)
    assert rl.allow() is True
    assert rl.remaining() == 1


def test_zero_cap_blocks_everything():
    rl = RateLimiter(per_hour=0, clock=FakeClock())
    assert rl.allow() is False


def test_default_cap_is_conservative_and_on():
    rl = RateLimiter(clock=FakeClock())
    assert rl.per_hour == DEFAULT_PER_HOUR == 10


def test_parse_per_hour_env():
    assert _parse_per_hour(None) == DEFAULT_PER_HOUR
    assert _parse_per_hour("") == DEFAULT_PER_HOUR
    assert _parse_per_hour("garbage") == DEFAULT_PER_HOUR
    assert _parse_per_hour("-5") == DEFAULT_PER_HOUR
    assert _parse_per_hour("0") == 0
    assert _parse_per_hour("25") == 25


def test_limiter_from_env_reads_knob():
    rl = limiter_from_env({"CALLISTHENES_THROTTLE_PER_HOUR": "7"})
    assert rl.per_hour == 7


def test_send_tools_default_and_override():
    assert _parse_send_tools(None) == frozenset(
        ("createPosts", "deletePosts", "mediaUpload", "post_reddit")
    )
    assert send_tools_from_env({"CALLISTHENES_SEND_TOOLS": "createPosts, foo"}) == (
        frozenset(("createPosts", "foo"))
    )
