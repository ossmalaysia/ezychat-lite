# EzyChat Lite roadmap

EzyChat Lite is an open-source rewrite of our internal EzyChat tool. We want businesses to
manage sales conversations easily, with security and straightforward setup built into the
foundation. Inspired by [EzyChat](https://ezychat.ai/), Lite starts with a free inbox that runs
on a computer you control.

This is a direction, not a release schedule. Planned features are not available yet; priorities
may change with feedback from businesses using the inbox.

| Stage                               | Status               | What it covers                                                                                                                                                          |
| ----------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic team inbox                    | Available; improving | One linked WhatsApp number, shared conversations, assignments, internal notes, quick replies, member roles, mobile access, notifications and local backups.             |
| Security and easy setup             | Ongoing              | Safer defaults, clear connection status, guided remote access, dependable updates, better recovery and accessible desktop/mobile workflows.                             |
| BYOK sales agent                    | Planned              | Optional AI assistance using your own provider API key: draft replies, summarise conversations, suggest follow-ups and answer from an approved business knowledge base. |
| Light CRM                           | Planned              | Customer profiles, tags, notes, simple sales stages, next actions and follow-up reminders alongside the conversation.                                                   |
| Business workflows and integrations | Exploring            | Team handovers, saved views, basic reporting, import/export, webhooks and integrations with tools businesses already use.                                               |

## Next: strengthen the inbox

- Make linking, reconnecting and bringing a new team online easier to understand.
- Improve search, contact-name consistency, message reliability and responsive layouts.
- Make release downloads and upgrades clearer, with data preservation and recovery guidance.
- Keep security checks, permissions and setup protections covered by tests.

## BYOK sales agent

- Let the hosting admin configure an optional provider and their own API key.
- Start with reply drafts, summaries and suggested next actions that people review before sending.
- Add a business knowledge base for product information and common questions.
- Show what leaves the machine, require explicit configuration, protect stored keys, and provide
  usage controls. AI providers may charge for usage; BYOK does not mean free AI.
- Explore controlled automation only after review, permissions, audit trails and a clear handover
  to a person are in place.

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
