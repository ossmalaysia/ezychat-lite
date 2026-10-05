/** Shared by live logging and support exports, including logs written before redaction existed. */
const SECRET_FIELDS = [
  'password',
  'token',
  'apiToken',
  'apiKey',
  'loginUrl',
  'authUrl',
  'accessToken',
  'refreshToken',
  'privateKey',
  'mediaKey',
  'keyData',
  'noiseKey',
  'signedIdentityKey',
  'signedPreKey',
  'advSecretKey',
  'authorization',
  'cookie',
  'set-cookie',
  // EXPERIMENTAL ChatGPT direct sign-in (OAuth tokens, PKCE, callback data).
  'idToken',
  'id_token',
  'access_token',
  'refresh_token',
  'authCode',
  'codeVerifier',
  'code_verifier',
  'oauthState',
  'authorizeUrl',
  'callbackUrl',
  'chatgptAccountId',
  'chatgpt-account-id',
];

const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const OAUTH_PARAM =
  /\b(code|state|code_verifier|code_challenge|access_token|refresh_token|id_token)=[^&\s"']+/gi;

/** Scrubs bearer JWTs and OAuth query parameters from free text (messages, URLs, stacks). */
export function redactSecretText(text: string): string {
  return text.replace(JWT, '[REDACTED_JWT]').replace(OAUTH_PARAM, '$1=[REDACTED]');
}

export const LOG_REDACT_PATHS = SECRET_FIELDS.flatMap((field) => [
  `["${field}"]`,
  `*["${field}"]`,
  `*.*["${field}"]`,
]);
const secrets = new Set(SECRET_FIELDS.map((field) => field.toLowerCase()));

function redact(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (secrets.has(key.toLowerCase())) {
      (value as Record<string, unknown>)[key] = '[REDACTED]';
    } else if (typeof child === 'string') {
      (value as Record<string, unknown>)[key] = redactSecretText(child);
    } else {
      redact(child);
    }
  }
}

/** Fail closed for incomplete/non-JSON records; never export an unexamined raw line. */
export function redactLogLine(line: string): string {
  try {
    const record: unknown = JSON.parse(line);
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error('Not a log record');
    redact(record);
    return JSON.stringify(record) + '\n';
  } catch {
    return '{"msg":"Unstructured or incomplete log record omitted from support export"}\n';
  }
}
