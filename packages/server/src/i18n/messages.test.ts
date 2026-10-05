import { describe, expect, it } from 'vitest';
import { catalogProblems, LOCALE_CODES } from '@wa-team-inbox/shared';
import { serverCatalogs, t } from './messages.js';

describe('server catalogs', () => {
  it.each(LOCALE_CODES)('%s matches the English keys and placeholders', (locale) => {
    expect(catalogProblems(serverCatalogs.en, serverCatalogs[locale])).toEqual([]);
  });

  it('translates with fallback to English', () => {
    expect(t('ms', 'push.newMessage')).toBe('Mesej baharu');
    expect(t(null, 'push.waUnavailable.body', { state: 'blocked' })).toBe(
      'Connection state: blocked',
    );
  });
});
