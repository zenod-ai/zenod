# Epic Z Night Sprint - SHIP evidence

Live deployment: `35f7cd8cb300b772e5ffca6dec70d37eef5752c1`

Landing: https://zenod.dev/

Customer app and MCP: https://cloud.zenod.dev/

The delivery manager completed one uninterrupted Chrome pass on the deployed
build:

1. Logged-out landing: `step-01-landing.jpg`
2. Exactly three pricing choices: `step-02-pricing.jpg`
3. GitHub sign-in returned to the named landing: `step-03-github-signin.jpg`
4. Stripe TEST monthly checkout: `step-04-stripe-test-checkout.jpg`
5. MCP-first customer dashboard: `step-05-dashboard-mcp.jpg`
6. Existing GitHub App selected and cloned
   `AlfaBlok/zenod-cloud-test-vault-4ptjqj`: `step-06-vault-connected.jpg`
7. Logout, GitHub login, and persisted vault: `step-07-logout-login-persistence.jpg`

MCP verification against the minted customer endpoint:

```json
{
  "initialize": {
    "protocolVersion": "2025-03-26",
    "server": "zenod"
  },
  "toolCall": {
    "name": "get_recent_conversation_transcript",
    "isError": false
  }
}
```

After capture, the screenshot-visible bearer credential was rotated and proved
invalid. The replacement credential was then verified with another successful
`initialize` and tool call; it is not present in these artifacts.

Domain receipts:

- `mind.zenod.dev/*` returns a path-preserving 301 to `zenod.dev/*`.
- `cloud-test.zenod.dev` returns 404.
- `zenod.zenod.dev` returns 404.
