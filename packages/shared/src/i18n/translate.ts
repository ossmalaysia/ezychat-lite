import { DEFAULT_LOCALE, type Locale } from './locales.js';

/** A nested string catalog; leaves may contain `{{name}}` placeholders. */
export type Catalog = { [key: string]: string | Catalog };

/** Dotted key paths of a catalog's string leaves, e.g. `push.waLoggedOut.title`. */
export type CatalogKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${CatalogKey<T[K]>}`;
}[keyof T & string];

export type Translator<T> = (
  locale: Locale | null | undefined,
  key: CatalogKey<T>,
  vars?: Record<string, string | number>,
) => string;

function lookup(catalog: Catalog | undefined, key: string): string | undefined {
  let node: string | Catalog | undefined = catalog;
  for (const part of key.split('.')) {
    if (node == null || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/**
 * Small, dependency-free translator for non-React surfaces (server push, desktop main process).
 * Missing keys fall back to English, then to the key itself.
 */
export function createTranslator<T extends Catalog>(
  source: T,
  catalogs: Partial<Record<Locale, Catalog>>,
): Translator<T> {
  return (locale, key, vars) => {
    const text = lookup(catalogs[locale ?? DEFAULT_LOCALE], key) ?? lookup(source, key) ?? key;
    return interpolate(text, vars);
  };
}

/** Flattened `key → text` pairs, used by catalog parity tests. */
export function flattenCatalog(catalog: Catalog, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[path] = v;
    else Object.assign(out, flattenCatalog(v, path));
  }
  return out;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** Base key for i18next plural forms: `items_one` / `items_other` → `items`. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * Differences between a translation and the English source: missing/extra keys, empty values and
 * placeholder mismatches. Plural suffixes are compared by base key because languages differ in
 * plural forms (Malay and Chinese only use `_other`).
 */
export function catalogProblems(source: Catalog, target: Catalog): string[] {
  const src = flattenCatalog(source);
  const tgt = flattenCatalog(target);
  const base = (k: string) => k.replace(PLURAL_SUFFIX, '');
  const vars = (s: string) =>
    [...s.matchAll(PLACEHOLDER)]
      .map((m) => m[1])
      .sort()
      .join(',');
  const srcBases = new Set(Object.keys(src).map(base));
  const tgtBases = new Set(Object.keys(tgt).map(base));
  const problems: string[] = [];
  for (const b of srcBases) if (!tgtBases.has(b)) problems.push(`missing: ${b}`);
  for (const b of tgtBases) if (!srcBases.has(b)) problems.push(`extra: ${b}`);
  const srcVarsByBase = new Map<string, string>();
  for (const [k, v] of Object.entries(src)) srcVarsByBase.set(base(k), vars(v));
  for (const [k, v] of Object.entries(tgt)) {
    if (!v.trim()) problems.push(`empty: ${k}`);
    const expected = srcVarsByBase.get(base(k));
    // `count` may be dropped from plural text in languages that don't need the number.
    const strip = (s: string) =>
      s
        .split(',')
        .filter((x) => x && x !== 'count')
        .join(',');
    if (expected !== undefined && strip(vars(v)) !== strip(expected))
      problems.push(`placeholders differ: ${k} (${vars(v)} vs ${expected})`);
  }
  return problems;
}
