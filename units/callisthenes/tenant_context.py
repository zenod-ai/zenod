"""Request-local tenant binding shared by the ported engine primitives."""

from __future__ import annotations

from contextvars import ContextVar

_tenant: ContextVar[str | None] = ContextVar("callisthenes_tenant", default=None)


def current_tenant() -> str | None:
    return _tenant.get()


def resolve_request_tenant() -> str:
    from auth import _default_tenant_resolver

    return _default_tenant_resolver()


def build_tenant_context_middleware(tenant_resolver=resolve_request_tenant):
    from fastmcp.server.middleware import Middleware

    class TenantContextMiddleware(Middleware):
        async def on_call_tool(self, context, call_next):
            token = _tenant.set(tenant_resolver())
            try:
                return await call_next(context)
            finally:
                _tenant.reset(token)

    return TenantContextMiddleware()


def runtime_x_credentials() -> dict[str, str]:
    """Return only the current tenant's saved X credentials, never another's."""
    tenant = current_tenant()
    if not tenant:
        return {}
    from connect_page import _read_x_config_file

    return _read_x_config_file(tenant=tenant)
