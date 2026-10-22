# Claude API provider interactive app proposal

A clone of the owner-confirmed **custom-agents** reference (the whole app, as on `main` at `117d57e`), with a
third AI connection: **Claude API key**. Settings → AI offers ChatGPT, OpenAI API key and Claude API key; the
inline connect card (agent page, setup wizard) offers "Use a Claude API key instead"; Voice messages hide the
cloud option with Claude. Scope, decisions and the screen checklist: [../design.md](../design.md). English
only for the new mock texts (the ms and zh-CN catalogs carry the English text).

From the repository root, after the normal `npm install`:

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123), OpenAI key saved.
npx tsx --conditions=ezychat-source docs/features/claude-provider/mock/run.ts --fake-wa
# First launch (setup wizard with the AI assistant step):
npx tsx --conditions=ezychat-source docs/features/claude-provider/mock/run.ts --fake-wa --fresh
```

Open `http://localhost:7493/` (API on `127.0.0.1:7492`). The Claude connection is mock-only and lives in this
browser (localStorage `mock.claudeProvider.v1`; the custom-agents keys stay as they were). Nothing calls
Anthropic or OpenAI: the runner blocks every outside request.

## Walkthrough

1. Sign in as `aisyah`, open **Settings → AI**. Three option cards; **OpenAI API key** is saved.
2. Choose **Claude API key**: the **Anthropic API key** field, **Test key**, the link **Get a key at
   console.anthropic.com**, the **Claude model** select (Sonnet 5.5 recommended, Opus 5.5, Haiku 5.5) and the
   note that voice notes use the on-device model.
3. Test keys: `sk-proj-abc1234567` (an OpenAI key: pointer to the right option), `ant-wrong` (rejected),
   `sk-ant-offline-123456` (Anthropic unreachable: warning, saving allowed), `sk-ant-demo-1234567` (works).
4. **Save AI connection** (an untested key is tested first): "Anthropic API key is saved." with **Replace
   key**; **Test connection** answers "Claude Sonnet 5.5 replied: Hello!"; the ready card links to the agents.
5. Open **More AI features → Voice messages**: no Cloud option, a note why (a warning if Cloud was chosen).
6. Open an agent (**Admin → Members → Aina**): "Connection: Anthropic API key is saved."
7. Back in Settings, choose **OpenAI API key** and save: the OpenAI key is still saved; choose **Claude API
   key** again: the Anthropic key is still saved too.
8. Connect card: with `--fresh`, finish the account and WhatsApp steps; the **AI assistant** step shows **Sign
   in with ChatGPT**, then **Use an OpenAI API key instead** and **Use a Claude API key instead**. A working key
   is tested and saved in one click ("Claude API key checked and saved").

## Checks

```powershell
npx tsc -p docs/features/claude-provider/mock/tsconfig.json
node docs/features/claude-provider/mock/snapshot.mjs --check
# With the seeded mock running (fresh browser contexts):
node docs/features/claude-provider/mock/claude-shots.mjs
```

Do not run `snapshot.mjs` without `--check`: that replaces the reference with the current app.
`agent-shots.mjs` and `inbox-shots.mjs` are the inherited custom-agents and multi-inbox scripts (pointed at this
mock's port).
