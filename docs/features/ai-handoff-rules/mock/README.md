# AI hand-off rules fixes (Closing chats per agent): interactive app proposal

A clone of the owner-confirmed **concept-tips** reference (the whole app, `latestConfirmed` revision `360d3be5`) with
the **ai-handoff-rules** proposal on top: each AI agent page gets a **Closing chats** card with one switch, **Ask if the
question is answered**. Off (the sales default) the agent adds no "Does that answer your question?" line and never
closes a chat; on, it asks and closes only on a clear "yes". Scope and checklist: [../design.md](../design.md).

From the repository root, after the normal `npm install` (Node 22 or later):

```powershell
# Seeded demo: admin aisyah, agents daniel and meiling (password demo-pass-123).
npx tsx --conditions=ezychat-source docs/features/ai-handoff-rules/mock/run.ts --fake-wa
```

Open `http://localhost:7489/`, sign in as `aisyah`.

## Walkthrough (this proposal)

1. **Admin → Members → AI agent** (Aina, sales): below Connectors, the **Closing chats** card with **Proposed**. The
   switch is off: "Aina adds no check-in line and never closes a chat. Your team closes chats."
2. The dashed **Mock only** box shows the same two customer messages: "Do you sell H100 GPUs? Where are you based?" →
   an answer with a discovery question and no check-in line; "yes we are in Malaysia" → the conversation goes on
   ("The chat stays open.").
3. Switch it on: the hint explains the resolution question, the first answer ends with "Does that answer your
   question?", and "yes we are in Malaysia" still continues ("A "yes" with new facts keeps the chat open").
4. Reload: the switch stays as you left it (kept per agent in this browser).

```powershell
node docs/features/ai-handoff-rules/mock/snapshot.mjs --check
node docs/features/ai-handoff-rules/mock/resolution-shots.mjs   # PW_CHROMIUM=<chrome> when Chrome is not installed
```

Everything below is the inherited concept-tips README; every inherited flow still works.

---
