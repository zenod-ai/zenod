from tenant_context import _tenant, current_tenant, runtime_x_credentials
import connect_page as cp


def test_runtime_credentials_follow_request_tenant(monkeypatch, tmp_path):
    monkeypatch.setenv("CALLISTHENES_X_CONFIG_PATH", str(tmp_path / "x-config.json"))
    cp._write_x_config_file({"X_OAUTH_ACCESS_TOKEN": "token-a"}, tenant="tenant-a")
    cp._write_x_config_file({"X_OAUTH_ACCESS_TOKEN": "token-b"}, tenant="tenant-b")

    token = _tenant.set("tenant-a")
    try:
        assert current_tenant() == "tenant-a"
        assert runtime_x_credentials()["X_OAUTH_ACCESS_TOKEN"] == "token-a"
    finally:
        _tenant.reset(token)

    token = _tenant.set("tenant-b")
    try:
        assert runtime_x_credentials()["X_OAUTH_ACCESS_TOKEN"] == "token-b"
    finally:
        _tenant.reset(token)
