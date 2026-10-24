# MCP sign-in (OAuth) for AI assistant apps

Status: built on `feat/mcp-oauth`. Owner request (2026-10-25): "it is difficult to understand security
header setup, we need most simple solution, continue until it is working, and just release". The owner
waived the separate HTML mock and its confirmation for this change; the screens are the existing
Settings → Integrations page (one new card) and one new approval page in the sign-in card style.

## Why

Connecting claude.ai, ChatGPT or Claude Desktop needed a token copied into an `Authorization` header.
Cloud apps (claude.ai and ChatGPT connectors) cannot take a header at all: they only sign in with
OAuth. The roadmap item was "MCP OAuth (approve the connection, no token copy)".

## What the admin does

1. Settings → Integrations: turn on AI assistant access. A card **Connect claude.ai, ChatGPT or Claude
   Desktop** shows the connector address (`<tunnel or local URL>/mcp`) with **Copy address**.
2. In the AI app, add a custom connector and paste the address.
3. The app opens EzyChat's approval page (`/oauth/authorize`). The admin signs in if needed, sees the
   app name, **Returns to <host>**, what it can do, and clicks **Approve** (or **Decline**).
4. The connection is an ordinary token in the Access tokens list (named after the app). The admin
   can allow sending (Permissions) or revoke it there.

## How (decided)

- Standard MCP authorization (spec 2025-06-18): `/mcp` 401 carries
  `WWW-Authenticate: Bearer … resource_metadata="<issuer>/.well-known/oauth-protected-resource/mcp"`;
  RFC 9728 protected resource metadata (also at the root path) and RFC 8414 authorization server
  metadata; issuer = request origin (`https://<tunnel host>` through the tunnel, `http://<host>` on
  this computer).
- Dynamic client registration (RFC 7591) at `POST /mcp/oauth/register`: redirect URIs https, loopback
  http or an app scheme (never `javascript:`/`data:`/`file:` …, no fragments); methods `none`,
  `client_secret_post`, `client_secret_basic` (secret stored as SHA-256). Table `oauth_clients`
  (migration 018). Apps that never got a token are removed after a day; at most 200 apps.
- Authorization code + PKCE S256 only. Codes: 32 random bytes, kept in memory by SHA-256, 5 minutes,
  one try (right or wrong), bound to app, redirect URI, challenge and the approving admin.
  `resource` (RFC 8707) must be this server's `/mcp` (or root) on the same origin.
- The approval page is the web app (`apps/web/src/auth/OAuthConsentPage.tsx`, inside `RequireAuth`);
  it calls `GET /api/oauth/request` and `POST /api/oauth/decision` (admin session, Origin check,
  rate-limited). A request that fails a check stays on the page with a message and never redirects.
  Audit `mcp.app_approve` / `mcp.app_deny` {clientId, redirectHost}.
- Token endpoint `POST /mcp/oauth/token` (form body) issues an `ezc_pat_` token through
  `ApiTokenService.createForApp`: scopes `inbox:read ai:setup`, never expires, replaces that app's
  earlier token for the same admin, column `api_tokens.oauth_client_id`. No refresh tokens (the token
  lives until revoked, like a Settings token). Re-checks the approving admin at swap time.
- Same reach as `/mcp`: off → 404, LAN peer → 403; `/mcp/oauth/*` sits under the access gate.

## Not done (follow-ups)

- Client ID metadata documents (URL client ids); refresh tokens and expiring access tokens; scopes
  chosen on the approval page (sending stays a later choice in Settings); CORS for browser-based MCP
  clients.
