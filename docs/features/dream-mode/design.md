# Dream mode — feature record

- Full design: [`docs/superpowers/specs/2026-11-14-dream-mode-design.md`](../../superpowers/specs/2026-11-14-dream-mode-design.md)
- Mock (quick mock, not an app clone; owner asked to see the screen first): [`mock/index.html`](mock/index.html),
  screenshots in `mock/screens/` (`node docs/features/dream-mode/mock/shots.mjs`). Open `mock/index.html` directly in
  a browser; `?state=off|waiting|auto|change|paused&theme=dark`.
- Source of the look: the AI agent page (`apps/web/src/admin/AiMemberPage.tsx`) and the app rail
  (`apps/web/src/nav/AppNav.tsx`); tokens from `apps/web/src/index.css`.

## Screens and states

| State                     | Desktop 1280 | Phone 360 | Dark |
| ------------------------- | ------------ | --------- | ---- |
| Off (first time)          | ✓            | ✓         | —    |
| On, changes wait for you  | ✓            | ✓         | ✓    |
| On, Apply by itself       | ✓            | ✓         | —    |
| See change (dialog)       | ✓            | ✓         | ✓    |
| Paused (AI not connected) | ✓            | ✓         | —    |

Not in the quick mock: the history beyond two nights, a stale change (the text was edited after the suggestion), an
expired change, long item names. The build covers them with the same components.

## Confirmation

- 2026-11-14, owner (Jazz): "look good" on the review page with the screenshots
  (https://claude.ai/artifact/WHi4QoU6owa1EdjteVRiUt), with "Apply by itself" limited to Business context facts as shown.
- Same message: "ensure the dream mode prompt to exclude forward msg, forward msg should not take as reference".
- Build approach B chosen by the owner ("B, go ahead").
