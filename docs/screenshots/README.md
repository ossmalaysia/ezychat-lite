# Screenshots

Product screenshots for the website, release notes and docs, one folder per module. Every shot uses
demo data only: the fictional "Kopi Apong" coffee shop on fake WhatsApp. No real customers or numbers.

| Folder           | What it shows                                                         |
| ---------------- | --------------------------------------------------------------------- |
| `inbox/`         | Shared inbox list with owner chips and unread counts                  |
| `chat/`          | Conversations: team replies, take-over event, notes, Chinese customer |
| `admin-members/` | Team members                                                          |
| `ai-member/`     | AI Sales Agent page (instructions, hand-off rules, Business context)  |
| `ai-settings/`   | AI connection settings                                                |
| `quick-replies/` | Quick replies                                                         |
| `whatsapp-link/` | WhatsApp page (fake WhatsApp shows "Fake": internal use only)         |
| `remote-access/` | Cloudflare remote access                                              |
| `settings/`      | Admin settings                                                        |

File names are `<screen>-<desktop|mobile>[-dark].png`: desktop is 1280×800, mobile 360×780, both at 2× pixel
density. Dark variants exist for the inbox and conversation only.

## Refresh

Run this whenever a UI change affects a module, on a **fresh** data folder:

```bash
npm run build -w @wa-team-inbox/web
npx tsx packages/server/src/cli.ts --data <new temp dir> --port 7477 --fake-wa --mode standalone --web-dist apps/web/dist
node e2e/marketing-screenshots.mjs http://127.0.0.1:7477 docs/screenshots
```

`--mode standalone` keeps the "Dev Build" badge out of the shots. The script saves a placeholder AI key and
leaves the AI member off, so it never calls OpenAI or ChatGPT.
