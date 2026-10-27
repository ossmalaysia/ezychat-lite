# Partner MCP test server (TEST ONLY)

A local partner MCP server for the connector list: unit tests, e2e and Dev Builds. Ported and
simplified from the Enterprise connector-testkit. Never imported by the app and never in a bundle.

One process on `127.0.0.1` (https, self-signed) serves one MCP endpoint per sign-in type with the same
demo data, and a **signed TEST connector list** with icons that describes these partners.

| Endpoint        | Path                 | Sign-in                                                                  | List entry    |
| --------------- | -------------------- | ------------------------------------------------------------------------ | ------------- |
| `oauth`         | `/oauth/mcp`         | OAuth: discovery, dynamic client registration, PKCE S256; Allow / Cancel | `test-lejar`  |
| `api-key`       | `/api-key/mcp`       | `Authorization: Bearer pk_test_kedai_4242`                               | `test-kedai`  |
| `credentials`   | `/credentials/mcp`   | `Basic demo:demo-pass-9876` and `X-Account: acme`                        | `test-gudang` |
| `oauth-own-app` | `/oauth-own-app/mcp` | OAuth with the admin's client `ezychat-own-app` / `own-app-secret-55`    | `test-bayar`  |
| `none`          | `/none/mcp`          | none                                                                     | `test-open`   |

Tools (all endpoints): `find_invoice` (read: INV-1001…INV-1003), `check_stock` (read: KA-HB-1KG,
KA-KY-400, KA-KP-250), `list_price_lists` (read: for the Price list setting), `create_quotation` (write:
draft Q-2001…), and `delete_invoice` (listed by no entry: the app must never offer it). The `oauth`
endpoint also accepts the public client ID `ezychat-public-test` (an entry's `auth.clientId`).

## Run

```bash
node e2e/partner-mcp/cli.mjs                 # https on :7610, prints endpoints, keys and env lines
node e2e/partner-mcp/cli.mjs --port 7611 --ttl 60 --control-token <token> --quiet
```

The certificate and the list signing key stay in the fixed folder `<tmp>/ezychat-partner-mcp`, so
the app keeps trusting restarts. Start the app with `--mode dev --fake-wa` (both: the allowance needs a dev run with fake WhatsApp) with the
printed lines, also written to `<tmp>/ezychat-partner-mcp/env.txt`:

```text
CONNECTORS_TEST_ALLOW_LOCAL=1                    # partner servers on this computer (test only)
NODE_EXTRA_CA_CERTS=<tmp>/ezychat-partner-mcp/cert.pem            # trust the self-signed certificate
EZYCHAT_CONNECTOR_LIST_URL=https://127.0.0.1:7610/connectors/
EZYCHAT_CONNECTOR_LIST_TEST_KEY=<base64 Ed25519 public key>
```

The list is served at `/connectors/list-v1.json`, `/connectors/list-v1.json.sig` and
`/connectors/icons/<id>.svg`. A browser shows a certificate warning on the OAuth consent page:
continue past it.

Switch an endpoint while running (states `ok`, `down` = connections dropped, `refused` = every call
answers 401 and OAuth grants are revoked, `rpc_error` = tool calls answer a JSON-RPC error):

```bash
POST <origin>/_control   Authorization: Bearer <printed control token>
{"endpoint":"oauth","state":"down"}
```

## In tests

```ts
import { startPartnerMcp, completeConsent } from '../../../e2e/partner-mcp/server.mjs';
const kit = await startPartnerMcp({ port: 0, tls: true }); // kit.cert is the PEM to trust
kit.setState('api-key', 'down');
await kit.close();
```

`completeConsent(authorizationUrl, 'allow', kit.cert)` presses Allow and returns the redirect (with
`code`). The request log holds endpoint, JSON-RPC method, tool name and status only.
