import { describe, expect, it } from 'vitest';
import { catalogProblems, LOCALE_CODES, type Catalog } from '@wa-team-inbox/shared';
import { NAMESPACES } from './resources';

const files = import.meta.glob<Catalog>('./locales/*/*.json', { eager: true, import: 'default' });
const catalog = (locale: string, ns: string) => files[`./locales/${locale}/${ns}.json`];

describe('web catalogs', () => {
  it('has no catalog files outside the supported locales and namespaces', () => {
    for (const path of Object.keys(files)) {
      const [, locale, ns] = /^\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path) ?? [];
      expect(LOCALE_CODES as readonly string[], path).toContain(locale);
      expect(NAMESPACES as readonly string[], path).toContain(ns);
    }
  });

  for (const locale of LOCALE_CODES.filter((l) => l !== 'en')) {
    for (const ns of NAMESPACES) {
      it(`${locale}/${ns} matches English keys and placeholders`, () => {
        const source = catalog('en', ns);
        const target = catalog(locale, ns);
        expect(target, `missing ./locales/${locale}/${ns}.json`).toBeDefined();
        expect(catalogProblems(source!, target!)).toEqual([]);
      });
    }
  }
});
