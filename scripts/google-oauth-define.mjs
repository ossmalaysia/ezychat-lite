// The Google sign-in app (a Google "Desktop app" OAuth client) that a release bundle carries, as an
// esbuild `define` for the global the server reads (`__EZYCHAT_GOOGLE_OAUTH__`, packages/server/src/config.ts).
// Release workflows pass GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET from repository secrets;
// local builds and forks have neither, so their Google Calendar shows "Not available in this build".
// A desktop client's secret ships in every installed copy (Google treats it as public; PKCE protects
// the sign-in). Never print the values.

/** esbuild `define` entries for the Google app, or {} when the build has none. Throws on half a pair. */
export function googleOAuthDefine(env = process.env) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return {};
  if (!clientId || !clientSecret)
    throw new Error('Set both GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, or neither');
  if (!clientId.endsWith('.apps.googleusercontent.com'))
    throw new Error('GOOGLE_OAUTH_CLIENT_ID is not a Google OAuth client id');
  return { __EZYCHAT_GOOGLE_OAUTH__: JSON.stringify({ clientId, clientSecret }) };
}
