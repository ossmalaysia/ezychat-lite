import { describe, expect, it } from 'vitest';
import { googleOAuthDefine } from './google-oauth-define.mjs';

const id = '123-abc.apps.googleusercontent.com';

describe('googleOAuthDefine', () => {
  it('adds nothing when the build has no Google app (local builds, forks)', () => {
    expect(googleOAuthDefine({})).toEqual({});
    expect(
      googleOAuthDefine({ GOOGLE_OAUTH_CLIENT_ID: ' ', GOOGLE_OAUTH_CLIENT_SECRET: '' }),
    ).toEqual({});
  });

  it('defines the app as one JSON value', () => {
    const define = googleOAuthDefine({
      GOOGLE_OAUTH_CLIENT_ID: ` ${id} `,
      GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-test',
    });
    expect(JSON.parse(define.__EZYCHAT_GOOGLE_OAUTH__)).toEqual({
      clientId: id,
      clientSecret: 'GOCSPX-test',
    });
  });

  it('refuses half a pair or a wrong client id, without echoing the values', () => {
    expect(() => googleOAuthDefine({ GOOGLE_OAUTH_CLIENT_ID: id })).toThrow('or neither');
    expect(() => googleOAuthDefine({ GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-test' })).toThrow(
      'or neither',
    );
    expect(() =>
      googleOAuthDefine({ GOOGLE_OAUTH_CLIENT_ID: 'x', GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-test' }),
    ).toThrow(/^GOOGLE_OAUTH_CLIENT_ID is not a Google OAuth client id$/);
  });
});
