# Dev Build checks

What has been checked by hand in a running **Dev Build** (fake WhatsApp, demo data), how, and what
is still untested. Automated tests cover the code paths; this log covers what only a running app
and, for AI work, a real model can show. Release checks with a real WhatsApp number are in
[manual-test-checklist.md](manual-test-checklist.md).

Read this log before testing a feature, and add a row after every Dev Build check (newest first).

## How to run a check

1. Build the web app from the branch under test: `npm run build -w @wa-team-inbox/web`. Stop any
   server that serves `apps/web/dist` first.
2. Start a Dev Build on a fresh temp data folder, never the real app data:
   `npx tsx packages/server/src/cli.ts --data <temp dir> --port 7490 --fake-wa --mode dev --web-dist apps/web/dist`
3. Seed demo data: `node e2e/marketing-screenshots.mjs 7490 <throwaway out dir>`. Sign in as
   `aisyah` / `demo-pass-123`. Farah Aziz has a full customer profile (tags VIP, Catering).
4. **AI checks** need a real model, so the owner signs in (Settings → AI) and agrees to the calls:
   - `node e2e/devbuild-ai-check.mjs 7490 prep` unassigns Farah's chat and adds a delivery fact;
   - turn the AI member on (Admin → Members → AI);
   - `node e2e/devbuild-ai-check.mjs 7490 send ["text"]` sends a message from Farah; the AI answers
     about 10 seconds later. After a hand-off the chat leaves the AI, so further scenarios use
     `new <digits> "text" [profile]`: a fresh number each time (`profile` saves Aminah's demo
     details, including the tags VIP and Late payer, before the AI answers).
   - read replies in the inbox (or `GET /api/chats/<jid>/messages`, field `body`).
5. Check screens at 1280 px and 360 px; keep screenshots outside the repo or under the ignored
   `.playwright-mcp/`.

## Log

| Date       | Build / PR                                                                                                               | Scenario                                       | Steps                                                                                                                                            | Result                                                                                                                                                                 | Not covered                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 2026-10-07 | #42 after review fixes (customer details moved into `currentSituation`; stale-detail regeneration), ChatGPT subscription | Re-run: saved details in Malay                 | `new 60177001004 "Salam, boleh hantar 50 pax nasi lemak ke tempat saya Jumaat ni?" profile`                                                      | Pass. "Salam Puan Aminah", used Bayan Lepas, priced 50 pax at RM600 from Business context, free delivery above RM300, handed the order to the team.                    | —                                                                                                        |
| 2026-10-07 | #42 after review fixes, ChatGPT subscription                                                                             | Re-run: "What do you have about me? Am I VIP?" | `new 60177001005 "What details do you have about me? Am I a VIP customer?" profile`                                                              | Pass. Read back the saved details on request; "no information confirming VIP status"; no tag leaked; handed off.                                                       | —                                                                                                        |
| 2026-10-07 | #42 after review fixes, ChatGPT subscription                                                                             | Re-run: no saved details                       | `new 60177001006 "Hi, do you deliver to Butterworth? How much for 20 pax?"`                                                                      | Pass. No name; prices from Business context.                                                                                                                           | A teammate editing details mid-reply (timing-dependent; covered by `ai.test.ts`).                        |
| 2026-10-07 | 0.1.23 + #42, ChatGPT subscription                                                                                       | Saved details, Malay                           | `new 60177001001 "Salam, boleh hantar 50 pax nasi lemak ke tempat saya Jumaat ni?" profile` (Aminah: Bayan Lepas address, tags VIP / Late payer) | Pass. Replied in Malay, "Salam Puan Aminah", used Bayan Lepas without asking, worked out the 2-day notice, handed the order to the team.                               | —                                                                                                        |
| 2026-10-07 | 0.1.23 + #42, ChatGPT subscription                                                                                       | No saved details                               | `new 60177001002 "Hi, do you deliver to Butterworth? How much for 20 pax?"`                                                                      | Pass. No name invented; RM180 and RM15 came from Business context; team confirms the price.                                                                            | —                                                                                                        |
| 2026-10-07 | 0.1.23 + #42, ChatGPT subscription                                                                                       | Customer asks what is on file + "Am I VIP?"    | `new 60177001003 "What details do you have about me? Am I a VIP customer?" profile`                                                              | Pass. Read back the saved details because the customer asked (allowed); "no information confirming VIP status": no tag leaked; handed off as a personal-data enquiry.  | Whether reading details back to whoever writes from the number is wanted (same rule as WhatsApp itself). |
| 2026-10-07 | 0.1.23 + #42 (AI customer details), ChatGPT sign-in                                                                      | AI uses saved customer details                 | Farah (profile: company, email, Georgetown address, tags VIP/Catering): "Hi, can you deliver 3 trays of nasi lemak to me this Saturday?"         | Pass. Reply opened with "Farah", answered for Penang without asking the address, no email read back, no tags mentioned, handed off as needs_action (order to confirm). | One message only; English only; API-key mode; customer without a profile (covered by unit tests).        |
