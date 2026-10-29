// The Zoho sign-in app (a Zoho API Console client) that a release bundle carries, as an esbuild
// `define` for the global the server reads (`__EZYCHAT_ZOHO_OAUTH__`, packages/server/src/config.ts).
// Release workflows pass ZOHO_OAUTH_CLIENT_ID / ZOHO_OAUTH_CLIENT_SECRET from repository secrets;
// local builds and forks have neither, so their Zoho CRM shows "Not available in this build".
// The secret ships in every installed copy, like the Google desktop client's. Never print the values.

/** esbuild `define` entries for the Zoho app, or {} when the build has none. Throws on half a pair. */
export function zohoOAuthDefine(env = process.env) {
  const clientId = env.ZOHO_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.ZOHO_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return {};
  if (!clientId || !clientSecret)
    throw new Error('Set both ZOHO_OAUTH_CLIENT_ID and ZOHO_OAUTH_CLIENT_SECRET, or neither');
  if (/\s/.test(clientId) || /\s/.test(clientSecret))
    throw new Error('ZOHO_OAUTH_CLIENT_ID / ZOHO_OAUTH_CLIENT_SECRET must not contain spaces');
  return { __EZYCHAT_ZOHO_OAUTH__: JSON.stringify({ clientId, clientSecret }) };
}
