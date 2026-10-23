# Screenshots

Product screenshots for the website, release notes and docs, one folder per module. Every shot uses
demo data only: the fictional "Kopi Apong" coffee shop on fake WhatsApp. No real customers or numbers.

| Folder                 | What it shows                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `inbox/`               | Shared inbox list with owner chips and unread counts                                                                                         |
| `chat/`                | Conversations: team replies, take-over event, notes, Chinese customer, Group info, reactions and the emoji bar (`react-bar-*`)               |
| `admin-members/`       | Team members                                                                                                                                 |
| `ai-member/`           | AI Sales Agent page (instructions, hand-off rules, Business context)                                                                         |
| `ai-settings/`         | AI connection settings                                                                                                                       |
| `quick-replies/`       | Quick replies                                                                                                                                |
| `whatsapp-link/`       | WhatsApp page (fake WhatsApp shows "Fake": internal use only)                                                                                |
| `remote-access/`       | Cloudflare remote access                                                                                                                     |
| `settings/`            | Admin settings                                                                                                                               |
| `customer-enrichment/` | Customer enrichment Settings, Audit, score details and source customer                                                                       |
| `ai-assistant/`        | AI assistant access: tokens with send badges, Permissions, the new-number warning, assistant replies                                         |
| `inboxes/`             | Several WhatsApp numbers (Enterprise): unified list with inbox chips and filter, Admin → Inboxes, Edit inbox, QR, Members access, agent view |

File names are `<screen>-<desktop|mobile>[-dark].png`: desktop is 1280×800, mobile 360×780, both at 2× pixel
density. Dark variants exist for the inbox, the conversation and the chat an AI assistant started. `inboxes/` comes from `node e2e/inbox-screens.mjs <url> <dir>` on a `--max-inboxes 3` Dev Build, so it shows the Dev Build badge.

## Refresh

Run this whenever a UI change affects a module, on a **fresh** data folder:

```bash
npm run build -w @ezychat/web
npx tsx packages/server/src/cli.ts --data <new temp dir> --port 7477 --fake-wa --mode standalone --web-dist apps/web/dist
node e2e/marketing-screenshots.mjs 7477 docs/screenshots
```

`--mode standalone` keeps the "Dev Build" badge out of the shots. The script saves a placeholder AI key and
leaves the AI member off, so it never calls OpenAI or ChatGPT.

## Customer enrichment

This module has 44 production UI captures at 1280×900 and 360×800 in both themes, including off,
editing, enabled, rules, paused, error, Audit, added/replaced details, long policy and source customer.
Its runner always uses a fresh temporary fake-WA data directory. Build the web and copy it into
`.playwright-mcp/enrichment-web` before starting the runner; stop any runner serving that copy
before refreshing it.

```powershell
node --import tsx e2e/enrichment-devbuild.ts --fake-wa --mock-ai --port 7490
node e2e/enrichment-screens.mjs 7490 docs/screenshots/customer-enrichment
```

Seed the fictional `aisyah` / `demo-pass-123` admin and new direct-chat messages first, enable
enrichment and exercise an addition and replacement. The screenshot runner requires the mock-AI
server marker, so it cannot run against the installed app or a real provider. Normal Audit captures
reuse actual generated audit rows; paused/error and long-policy states are network fixtures.
