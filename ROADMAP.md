# EzyChat Lite roadmap

EzyChat Lite is an open-source rewrite of our internal EzyChat tool. We want businesses to
manage sales conversations easily, with security and straightforward setup built into the
foundation. Inspired by [EzyChat](https://ezychat.ai/), Lite starts with a free inbox that runs
on a computer you control.

This is a direction, not a release schedule. Planned features are not available yet; priorities
may change with feedback from businesses using the inbox.

| Stage                               | Status               | What it covers                                                                                                                                                                               |
| ----------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic team inbox                    | Available; improving | One linked WhatsApp number, shared conversations, assignments, internal notes, quick replies, member roles, mobile access, notifications and local backups.                                  |
| Security and easy setup             | Ongoing              | Safer defaults, clear connection status, guided remote access, dependable updates, better recovery and accessible desktop/mobile workflows.                                                  |
| AI sales agent                      | In preview           | Optional AI member that answers basic questions from your business context, hands off to people and closes chats only after the customer confirms. Uses your own API key or ChatGPT sign-in. |
| Light CRM                           | Planned              | Customer profiles, tags, notes, simple sales stages, next actions and follow-up reminders alongside the conversation.                                                                        |
| Business workflows and integrations | Exploring            | Team handovers, saved views, basic reporting, import/export, webhooks and integrations with tools businesses already use.                                                                    |

## Next: strengthen the inbox

- Make linking, reconnecting and bringing a new team online easier to understand.
- Improve search, contact-name consistency, message reliability and responsive layouts.
- Make release downloads and upgrades clearer, with data preservation and recovery guidance.
- Keep security checks, permissions and setup protections covered by tests.

## AI sales agent

In preview:

- An optional AI member, set up on its own page: AI instructions plus a business context list
  (uploaded TXT/PDF/MD/DOCX files and text you add), with **Try it** before turning it on.
- Connect with your own OpenAI API key or, experimentally, a ChatGPT sign-in.
- It answers from your context only, hands complaints, refunds and missing facts to a person, and
  closes a chat only after the customer confirms. Customers never see error messages.

Next:

- **AI actions:** a clear, extensible set of things the agent may do in the inbox (resolve, hand
  off, add an internal note, then more), each with code-level checks, an audit trail and an admin
  switch; risky actions become "AI drafts, a person approves".
- **Voice:** the team sends voice notes; the agent understands customer voice messages through
  transcription.
- Reply drafts and conversation summaries that people review before sending.
- Usage controls and a clear view of what leaves the machine. AI providers may charge for usage;
  your own key does not mean free AI.

## Light CRM

- Keep one useful customer profile alongside their conversation history.
- Add tags, simple lead stages, owners, notes and follow-up reminders.
- Make it easy to see who needs a reply or next action, without turning the inbox into a large CRM.
- Explore customer import/export and a small set of sales activity reports.

## Help shape it

Tell us the business workflow you are trying to improve, who uses it, and what is difficult today.
[Request a feature](https://github.com/ossmalaysia/ezychat-lite/issues/new?template=feature_request.yml)
or [contribute](CONTRIBUTING.md). Suggestions are welcome; inclusion here does not promise a
delivery date.
