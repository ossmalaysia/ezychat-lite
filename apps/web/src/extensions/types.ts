import type { ComponentType, ReactNode } from 'react';
import { LOCALE_CODES, type Inbox, type Locale } from '@ezychat/shared';

/**
 * Web extension API: lets another product build (e.g. Enterprise) add UI without forking Lite.
 *
 * - `routes` mount only under `/ext/<name>/<path>` (signed-in users) or, with `admin: true`, under
 *   `/admin/ext/<name>/<path>` inside the admin shell. They can never replace a core route.
 * - `adminNav` links point at the extension's admin routes (`/admin/ext/<name>/<path>`).
 * - `settingsSections` render in Settings → Integrations, below the core sections.
 * - `agentSections` render as rows on an AI agent's page (`/admin/members/ai` for the Sales
 *   Agent), right under Business context.
 * - An admin route may declare the core admin `section` it belongs to (e.g. `members` for an
 *   agent sub-page): that nav item is highlighted and the phone header shows its label.
 * - An admin nav item may show a small badge (a count or "needs attention") from `useBadge`.
 * - `banners` render in one slim bar at the top of the signed-in shell (inbox and admin); the
 *   first banner that renders something wins, the others stay hidden.
 * - `lockScreen` replaces the core "paused" screen while the server's access gate is closed
 *   (GET /api/access, or any API call answering 403 with the gate code). It is shown without
 *   sign-in; `recheck()` reads the gate again and the app reloads once it is open.
 * - `catalogs` add translation keys to the `common` namespace; every key must start with
 *   `ext.<name>.`. A key missing in one language falls back to English like core keys.
 *
 * Every extension element is wrapped in the app's ErrorBoundary.
 */
export interface WebExtensionRoute {
  /** Relative path below the extension's prefix, e.g. `reports` or `reports/:id`. */
  path: string;
  element: ReactNode;
  /** Mount in the admin shell (admins only) instead of the signed-in user area. */
  admin?: boolean;
  /**
   * Admin routes only: the core admin section this page sits under (e.g. `members` for
   * `/admin/ext/<name>/agents/ai`). Highlights that nav item and names it in the phone header.
   * The page still renders its own breadcrumb.
   */
  section?: WebExtensionAdminSection;
}

/** Core admin sections an extension admin route may sit under (the `ADMIN_NAV` paths). */
export const WEB_EXTENSION_ADMIN_SECTIONS = [
  'members',
  'quick-replies',
  'connectors',
  'whatsapp',
  'inboxes',
  'tunnel',
  'settings',
  'audit',
] as const;
export type WebExtensionAdminSection = (typeof WEB_EXTENSION_ADMIN_SECTIONS)[number];

/** A small badge on an admin nav link: a count, or a dot that asks for attention. */
export interface WebExtensionNavBadge {
  /** Shown when above 0 (99+ above 99). */
  count?: number;
  /** A dot when there is no count, e.g. a connector that needs signing in again. */
  attention?: boolean;
  /** Translation key (`ext.<name>.…`) read by screen readers, e.g. "2 need attention". */
  labelKey?: string;
  /** Values for `labelKey`'s placeholders. */
  labelValues?: Record<string, string | number>;
}

export interface WebExtensionNavItem {
  /** Path of one of this extension's admin routes (relative, as in `routes[].path`). */
  path: string;
  /** Translation key (`ext.<name>.…`) of the link label. */
  labelKey: string;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /**
   * React hook (called on every admin render, so keep it cheap: read a cached query) returning
   * the badge to show, or null for none. Errors in it hide the badge, never the nav.
   */
  useBadge?: () => WebExtensionNavBadge | null;
}

/** The AI agents whose page can hold extension rows. Only the Sales Agent exists today. */
export type WebExtensionAgent = 'sales';

export interface WebExtensionAgentSection {
  agent: WebExtensionAgent;
  /** Unique within the extension; lowercase letters, digits and dashes. */
  id: string;
  /** One compact row (e.g. "Connectors · 2 connected · Manage ›"); details on its own page. */
  element: ReactNode;
}

export interface WebExtensionSettingsSection {
  /** Unique within the extension; lowercase letters, digits and dashes. */
  id: string;
  /** Translation key (`ext.<name>.…`) of the section heading. */
  titleKey: string;
  element: ReactNode;
}

/** Props of an extension's lock screen. */
export interface WebExtensionLockScreenProps {
  /** The gate code from the server, e.g. `license_required`. */
  code: string;
  /** Read GET /api/access again now (the app reloads when access is open). */
  recheck: () => void;
}

export type WebExtensionCatalogs = Partial<Record<Locale, Record<string, string>>>;

/** The draft of the Add inbox dialog that a type's CreateForm receives. */
export interface WebExtensionInboxDraft {
  name: string;
  memberIds: number[];
  aiAgentId: number | null;
}

/**
 * The screens of an inbox connection type an extension adds on the server (`ServerExtension.inboxTypes`),
 * e.g. the WhatsApp Business API. The core shows a type choice in Add inbox (linked phone first) and in
 * the setup wizard's WhatsApp step, and places these components; the type's own routes do the work.
 */
export interface WebExtensionInboxType {
  /** The server inbox type id (`Inbox.type`). */
  type: string;
  /** Catalog keys (`ext.<name>.…`) of the choice card. */
  labelKey: string;
  descriptionKey: string;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /**
   * Add inbox, after the core's name/members/AI agent fields: collects the type's details, creates the
   * inbox through the extension's route, then calls `onCreated`. `validate()` checks the core fields
   * first (shows their errors) and says whether they are valid.
   */
  CreateForm: ComponentType<{
    draft: WebExtensionInboxDraft;
    validate: () => boolean;
    onCreated: (inbox: Inbox) => void;
  }>;
  /** Rows under an inbox of this type on its Admin → Inboxes card. */
  CardDetails?: ComponentType<{ inbox: Inbox }>;
  /** Edit dialog section for an inbox of this type (details, replace credentials, switch back). */
  EditSection?: ComponentType<{ inbox: Inbox; onChanged: () => void }>;
  /** Edit dialog of a linked-phone inbox: the flow that moves it to this type. */
  SwitchFromPhone?: ComponentType<{ inbox: Inbox; onChanged: () => void; onCancel: () => void }>;
  /** Setup wizard WhatsApp step: connects inbox 1 with this type instead of the QR scan. */
  SetupForm?: ComponentType<{ onConnected: () => void }>;
}

export interface WebExtension {
  /** Lowercase id, 2–32 characters: `/^[a-z][a-z0-9-]{1,31}$/`; not `lite` or `core`. */
  name: string;
  routes?: WebExtensionRoute[];
  adminNav?: WebExtensionNavItem[];
  settingsSections?: WebExtensionSettingsSection[];
  agentSections?: WebExtensionAgentSection[];
  /** Slim one-line bars for the top of the signed-in shell; the first non-empty one is shown. */
  banners?: ComponentType[];
  /** Full-page screen while access is closed; the first extension that has one wins. */
  lockScreen?: ComponentType<WebExtensionLockScreenProps>;
  /** Inbox connection types (Admin → Inboxes, setup wizard); the first extension wins a duplicate. */
  inboxTypes?: WebExtensionInboxType[];
  /**
   * Admin → Connectors: connectors this extension provides, by catalog id (e.g. `custom-mcp`), each
   * pointing at one of its admin pages (`/admin/ext/<name>/…`). The gallery card and the
   * connector's page then open that page; the first extension wins a duplicate id.
   */
  connectorLinks?: Partial<Record<string, string>>;
  catalogs?: WebExtensionCatalogs;
}

export const EXTENSION_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const RESERVED_NAMES = new Set(['lite', 'core']);
const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** One plain segment of a connector link (no params, no `..`). */
const LINK_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
/** One route segment: a name, a `:param` or a final `*` splat. No `..`, no leading slash. */
const SEGMENT_PATTERN = /^(?:[A-Za-z0-9_-]+|:[A-Za-z][A-Za-z0-9_]*|\*)$/;

/** A React component: a function, or an object made by `memo`/`forwardRef`/`lazy`. */
function isComponent(value: unknown): boolean {
  return (
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && '$$typeof' in value)
  );
}

export class WebExtensionError extends Error {
  override name = 'WebExtensionError';
}

function validRoutePath(path: string): boolean {
  if (typeof path !== 'string' || path === '' || path.length > 200) return false;
  const segments = path.split('/');
  return segments.every(
    (s, i) => SEGMENT_PATTERN.test(s) && (s !== '*' || i === segments.length - 1),
  );
}

/** Prefix that every catalog, nav and section key of an extension must start with. */
export function extensionKeyPrefix(name: string): string {
  return `ext.${name}.`;
}

/** URL of an extension route. */
export function extensionPath(name: string, path: string, admin = false): string {
  return `${admin ? '/admin' : ''}/ext/${name}/${path}`;
}

/**
 * Checks a list of extensions and throws a `WebExtensionError` naming the first problem.
 * Returns the same list so callers can write `validateWebExtensions(list)` inline.
 */
export function validateWebExtensions(
  extensions: readonly WebExtension[],
): readonly WebExtension[] {
  const names = new Set<string>();
  for (const ext of extensions) {
    const name = ext?.name;
    if (typeof name !== 'string' || !EXTENSION_NAME_PATTERN.test(name))
      throw new WebExtensionError(`Invalid web extension name: ${JSON.stringify(name)}`);
    if (RESERVED_NAMES.has(name))
      throw new WebExtensionError(`Web extension name "${name}" is reserved`);
    if (names.has(name)) throw new WebExtensionError(`Duplicate web extension name "${name}"`);
    names.add(name);

    const prefix = extensionKeyPrefix(name);
    const key = (k: unknown, what: string) => {
      if (typeof k !== 'string' || !k.startsWith(prefix) || k.length === prefix.length)
        throw new WebExtensionError(
          `Web extension "${name}": ${what} ${JSON.stringify(k)} must start with "${prefix}"`,
        );
    };

    const seen = { user: new Set<string>(), admin: new Set<string>() };
    for (const route of ext.routes ?? []) {
      if (!validRoutePath(route.path))
        throw new WebExtensionError(
          `Web extension "${name}": invalid route path ${JSON.stringify(route.path)}`,
        );
      if (
        route.section !== undefined &&
        (!route.admin ||
          !(WEB_EXTENSION_ADMIN_SECTIONS as readonly string[]).includes(route.section))
      )
        throw new WebExtensionError(
          `Web extension "${name}": route "${route.path}" has an invalid section ${JSON.stringify(route.section)}`,
        );
      const bucket = route.admin ? seen.admin : seen.user;
      if (bucket.has(route.path))
        throw new WebExtensionError(`Web extension "${name}": duplicate route "${route.path}"`);
      bucket.add(route.path);
    }

    for (const item of ext.adminNav ?? []) {
      if (!seen.admin.has(item.path))
        throw new WebExtensionError(
          `Web extension "${name}": admin nav path ${JSON.stringify(item.path)} has no admin route`,
        );
      key(item.labelKey, 'nav labelKey');
      if (item.useBadge !== undefined && typeof item.useBadge !== 'function')
        throw new WebExtensionError(`Web extension "${name}": nav useBadge must be a function`);
    }

    const agentIds = new Set<string>();
    for (const section of ext.agentSections ?? []) {
      if (section.agent !== 'sales')
        throw new WebExtensionError(
          `Web extension "${name}": unknown agent ${JSON.stringify(section.agent)}`,
        );
      if (typeof section.id !== 'string' || !SECTION_ID_PATTERN.test(section.id))
        throw new WebExtensionError(
          `Web extension "${name}": invalid agent section id ${JSON.stringify(section.id)}`,
        );
      const id = `${section.agent}:${section.id}`;
      if (agentIds.has(id))
        throw new WebExtensionError(
          `Web extension "${name}": duplicate agent section "${section.id}"`,
        );
      agentIds.add(id);
    }

    const sectionIds = new Set<string>();
    for (const section of ext.settingsSections ?? []) {
      if (typeof section.id !== 'string' || !SECTION_ID_PATTERN.test(section.id))
        throw new WebExtensionError(
          `Web extension "${name}": invalid settings section id ${JSON.stringify(section.id)}`,
        );
      if (sectionIds.has(section.id))
        throw new WebExtensionError(
          `Web extension "${name}": duplicate settings section "${section.id}"`,
        );
      sectionIds.add(section.id);
      key(section.titleKey, 'settings titleKey');
    }

    if (ext.banners !== undefined) {
      if (!Array.isArray(ext.banners))
        throw new WebExtensionError(`Web extension "${name}": banners must be a list`);
      for (const banner of ext.banners)
        if (!isComponent(banner))
          throw new WebExtensionError(`Web extension "${name}": every banner must be a component`);
    }
    if (ext.connectorLinks !== undefined) {
      if (typeof ext.connectorLinks !== 'object' || ext.connectorLinks === null)
        throw new WebExtensionError(`Web extension "${name}": connectorLinks must be an object`);
      const linkPrefix = `/admin/ext/${name}/`;
      for (const [id, href] of Object.entries(ext.connectorLinks)) {
        if (!SECTION_ID_PATTERN.test(id))
          throw new WebExtensionError(
            `Web extension "${name}": invalid connector id ${JSON.stringify(id)}`,
          );
        const rest =
          typeof href === 'string' && href.startsWith(linkPrefix)
            ? href.slice(linkPrefix.length)
            : '';
        if (
          !rest ||
          rest.length > 200 ||
          !rest.split('/').every((s) => LINK_SEGMENT_PATTERN.test(s))
        )
          throw new WebExtensionError(
            `Web extension "${name}": connector link for "${id}" must be an absolute "${linkPrefix}…" path`,
          );
      }
    }
    if (ext.lockScreen !== undefined && !isComponent(ext.lockScreen))
      throw new WebExtensionError(`Web extension "${name}": lockScreen must be a component`);

    for (const [locale, catalog] of Object.entries(ext.catalogs ?? {})) {
      if (!(LOCALE_CODES as readonly string[]).includes(locale))
        throw new WebExtensionError(`Web extension "${name}": unknown catalog locale "${locale}"`);
      for (const [k, v] of Object.entries(catalog ?? {})) {
        key(k, 'catalog key');
        if (typeof v !== 'string')
          throw new WebExtensionError(
            `Web extension "${name}": catalog value for "${k}" must be text`,
          );
      }
    }
  }
  return extensions;
}
