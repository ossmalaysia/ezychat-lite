import type { ComponentType, ReactNode } from 'react';
import { LOCALE_CODES, type Locale } from '@ezychat/shared';

/**
 * Web extension API: lets another product build (e.g. Enterprise) add UI without forking Lite.
 *
 * - `routes` mount only under `/ext/<name>/<path>` (signed-in users) or, with `admin: true`, under
 *   `/admin/ext/<name>/<path>` inside the admin shell. They can never replace a core route.
 * - `adminNav` links point at the extension's admin routes (`/admin/ext/<name>/<path>`).
 * - `settingsSections` render in Settings → Integrations, below the core sections.
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
}

export interface WebExtensionNavItem {
  /** Path of one of this extension's admin routes (relative, as in `routes[].path`). */
  path: string;
  /** Translation key (`ext.<name>.…`) of the link label. */
  labelKey: string;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

export interface WebExtensionSettingsSection {
  /** Unique within the extension; lowercase letters, digits and dashes. */
  id: string;
  /** Translation key (`ext.<name>.…`) of the section heading. */
  titleKey: string;
  element: ReactNode;
}

export type WebExtensionCatalogs = Partial<Record<Locale, Record<string, string>>>;

export interface WebExtension {
  /** Lowercase id, 2–32 characters: `/^[a-z][a-z0-9-]{1,31}$/`; not `lite` or `core`. */
  name: string;
  routes?: WebExtensionRoute[];
  adminNav?: WebExtensionNavItem[];
  settingsSections?: WebExtensionSettingsSection[];
  catalogs?: WebExtensionCatalogs;
}

export const EXTENSION_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const RESERVED_NAMES = new Set(['lite', 'core']);
const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** One route segment: a name, a `:param` or a final `*` splat. No `..`, no leading slash. */
const SEGMENT_PATTERN = /^(?:[A-Za-z0-9_-]+|:[A-Za-z][A-Za-z0-9_]*|\*)$/;

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
