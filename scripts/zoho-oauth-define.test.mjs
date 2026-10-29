import { describe, expect, it } from 'vitest';
import { zohoOAuthDefine } from './zoho-oauth-define.mjs';

describe('zohoOAuthDefine', () => {
  it('adds nothing when the build has no Zoho app (local builds, forks)', () => {
    expect(zohoOAuthDefine({})).toEqual({});
    expect(zohoOAuthDefine({ ZOHO_OAUTH_CLIENT_ID: ' ', ZOHO_OAUTH_CLIENT_SECRET: '' })).toEqual(
      {},
    );
  });

  it('defines the app as one JSON value', () => {
    const define = zohoOAuthDefine({
      ZOHO_OAUTH_CLIENT_ID: ' 1000.TESTCLIENT ',
      ZOHO_OAUTH_CLIENT_SECRET: 'test-secret',
    });
    expect(JSON.parse(define.__EZYCHAT_ZOHO_OAUTH__)).toEqual({
      clientId: '1000.TESTCLIENT',
      clientSecret: 'test-secret',
    });
  });

  it('refuses half a pair or a value with spaces, without echoing the values', () => {
    expect(() => zohoOAuthDefine({ ZOHO_OAUTH_CLIENT_ID: '1000.X' })).toThrow('or neither');
    expect(() => zohoOAuthDefine({ ZOHO_OAUTH_CLIENT_SECRET: 's' })).toThrow('or neither');
    let message = '';
    try {
      zohoOAuthDefine({ ZOHO_OAUTH_CLIENT_ID: '1000.X Y', ZOHO_OAUTH_CLIENT_SECRET: 'abc' });
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/spaces/);
    expect(message).not.toContain('1000.X');
  });
});
