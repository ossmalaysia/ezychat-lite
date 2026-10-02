# Design System — "Calm Desk"

WA Team Inbox is a tool people keep open all day to answer customers. The design language is
**quiet, dense, and work-focused**: neutral surfaces, colour only where it carries meaning
(unread, assignment, status, connection state), and clear separation between what the customer
sees and what only the team sees.

## Principles

1. **Meaningful colour only.** Neutral slate UI; the teal accent marks primary actions, selection,
   and focus. Semantic colours mark state. Never decorative colour.
2. **Internal ≠ external.** Internal notes are amber cards, system events are centred chips,
   customer-visible bubbles are neutral (inbound) or teal-tinted (outbound). Nothing internal
   may look like a message bubble.
3. **Mobile is first-class.** Most agents use a phone via the tunnel. Every screen works at 360px.
4. **Compose, don't hand-build.** Feature code composes components from `src/components/ui`.
   No raw `<button>`, ad-hoc modals, or one-off colour classes in feature code.
5. **Not WhatsApp.** No WhatsApp green, logo, or chat-wallpaper imitation (trademark + clarity).

## Foundations

### Stack

| Concern | Choice |
|---|---|
| Primitives | [shadcn/ui](https://ui.shadcn.com) (Radix UI) — source lives in `apps/web/src/components/ui/` |
| Variants | `class-variance-authority` + `tailwind-merge` via `cn()` in `src/lib/utils.ts` |
| Icons | `lucide-react` (stroke 1.75, 16/20px) |
| Toasts | `sonner` |
| Mobile sheets | `vaul` (Drawer) |
| Command / pickers | `cmdk` (quick-reply picker, chat switcher) |

### Colour tokens (CSS variables in `src/index.css`, mapped into Tailwind 4 `@theme`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | slate-50 `#F8FAFC` | `#0B1220` | app background |
| `--surface` | white | `#111827` | cards, panes, inbound bubble |
| `--muted` | slate-100 | `#1F2937` | hover, secondary surfaces |
| `--muted-foreground` | slate-500 | slate-400 | secondary text |
| `--foreground` | slate-900 | slate-100 | primary text |
| `--border` | slate-200 | `#243042` | dividers, inputs |
| `--accent` / `--primary` | teal-700 `#0F766E` | teal-500 `#14B8A6` | primary actions, selection, focus ring |
| `--primary-foreground` | white | `#04201D` | text on primary |
| `--outbound` | teal-50 `#F0FDFA` | `#0F2E2B` | outbound bubble |
| `--note` | amber-50 `#FFFBEB` / border amber-300 | `#2B2111` / amber-700 | internal notes |
| `--success` | green-600 | green-500 | delivered/read, connected |
| `--warning` | amber-500 | amber-400 | connecting, pending |
| `--danger` | red-600 | red-500 | failed, logged out, destructive |
| `--info` | sky-600 | sky-400 | informational banners |
| `--unread` | teal-600 | teal-400 | unread badge |

### Type

Inter (self-hosted via `@fontsource-variable/inter`), fallback system UI stack.
Scale: 12 (meta), 13 (dense lists), 14 (body), 16 (inputs, mobile body), 18/20 (titles).
Inputs are **≥16px** on mobile to avoid iOS zoom.

### Spacing, radius, elevation, motion

- 4px grid (Tailwind default scale).
- Radius: `--radius-sm 6px` (inputs, chips), `--radius 10px` (cards, buttons), `--radius-lg 16px` (sheets, bubbles).
- Elevation: `shadow-sm` (cards), `shadow-lg` (popovers/dialogs) — nothing else.
- Motion: 150ms ease-out; respect `prefers-reduced-motion`.
- Touch targets ≥ 44px on touch devices (`size="touch"` button variant / `min-h-11`).

## Components (all in `src/components/ui`)

Button (variants: default, secondary, outline, ghost, destructive, link; sizes: sm, default, lg, icon, touch),
Input, Textarea, Label, Form field wrapper, Select, Checkbox, Switch, RadioGroup, Tabs, Badge,
Avatar, Card, Dialog, AlertDialog (confirmations), Sheet / Drawer (mobile), DropdownMenu, Popover,
Tooltip, Command, ScrollArea, Separator, Skeleton, Sonner Toaster, Table (+ responsive card list),
EmptyState (illustration + title + action), StatusDot (wa/tunnel states), Banner (info/warning/danger).

App-level composites live in `src/components/app/` (e.g. `ChatAvatar`, `AssigneeSelect`,
`MessageStatusIcon`, `ConnectionBadge`, `PageHeader`, `ResponsiveTable`).

## Patterns

- **Confirmations** use `AlertDialog` (logout WhatsApp, reset password, reply to someone else's chat).
- **Feedback** uses toasts for success/failure of actions; inline `Banner` for persistent state
  (WhatsApp disconnected, tunnel error, LAN over HTTP).
- **Empty states** use `EmptyState` with an illustration from `public/illustrations/`.
- **Loading** uses `Skeleton` rows, not spinners, for lists.
- **Small screens:** Dialog → Drawer (bottom sheet) below `sm`; tables → stacked cards below `md`;
  admin side nav → top Tabs/Sheet below `md`.

## Brand assets (`apps/web/public`, `apps/desktop/build`)

App icon: teal rounded square, white inbox-tray glyph with a rising chat bubble; no text.
Generated variants: `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
`apple-touch-icon.png`, `favicon.ico`, desktop `icon.ico` / `icon.icns` / tray template images.
Illustrations (empty inbox, no results, link WhatsApp, tunnel, welcome) share one flat style:
teal + slate palette, thin line work, no people's faces, no brand logos.

## Rules for contributors (enforced)

- ESLint `no-restricted-syntax` blocks raw `<button>`, `<dialog>`, `<select>` in `src/**`
  outside `src/components/ui/**`.
- No hard-coded hex colours or Tailwind palette colours (e.g. `bg-emerald-600`) outside
  `src/index.css` and `src/components/ui/**` — use token classes (`bg-primary`, `text-muted-foreground`).
- New UI primitive → add it via `npx shadcn@latest add <name>` and adjust to tokens.
