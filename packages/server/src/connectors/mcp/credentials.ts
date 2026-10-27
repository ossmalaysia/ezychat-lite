// What the admin enters for the api_key and credentials sign-ins, and the headers EzyChat sends.
// Header-name rules ported from Enterprise ent-connectors (packages/ent-connectors/src/credentials.ts);
// templates (`{key}`, `{field}`, `{a:b}`) are new for list entries.
import type { ConnectorAuth } from '@ezychat/shared';
import { errors } from '../../http/errors.js';

export const MAX_SECRET_CHARS = 4000;
/** A non-secret field that fills `{field}` in `mcp.url` (a tenant or account name). */
const URL_FIELD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** Header names EzyChat or the MCP transport set, or that change how a request is routed or read. */
const FORBIDDEN_HEADERS = new Set([
  'host',
  'cookie',
  'set-cookie',
  'content-length',
  'content-type',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'accept',
  'accept-encoding',
  'origin',
  'referer',
  'forwarded',
  'via',
  'mcp-session-id',
  'mcp-protocol-version',
  'mcp-method',
  'mcp-name',
  'last-event-id',
]);

export type HeaderProblem = 'header_name_invalid' | 'header_name_forbidden';

/** Why a header name is not allowed, or null when it is fine. */
export function headerNameProblem(raw: string): HeaderProblem | null {
  const name = raw.trim().toLowerCase();
  if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(name)) return 'header_name_invalid';
  if (
    FORBIDDEN_HEADERS.has(name) ||
    name.startsWith('proxy-') ||
    name.startsWith('sec-') ||
    name.startsWith('x-forwarded-')
  )
    return 'header_name_forbidden';
  return null;
}

/** Visible ASCII and spaces/tabs only: no CR/LF (header injection) and no other control chars. */
export function safeHeaderValue(value: string): boolean {
  return /^[\t\x20-\x7e]*$/.test(value);
}

/** A key, client ID or secret: printable ASCII without spaces, at most 4000 characters. */
export function checkSecret(raw: unknown, what: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw errors.validation(`Enter the ${what}`);
  if (value.length > MAX_SECRET_CHARS || !/^[\x21-\x7e]+$/.test(value))
    throw errors.validation(`The ${what} contains characters that are not allowed`);
  return value;
}

/** A credentials field: printable text (spaces allowed inside), at most 4000 characters. */
function checkField(raw: unknown, id: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw errors.validation(`Fill in ${id}`);
  if (value.length > MAX_SECRET_CHARS || !/^[\x20-\x7e]+$/.test(value))
    throw errors.validation(`${id} contains characters that are not allowed`);
  return value;
}

/** `{name}` or `{a:b}` (Basic of two values) in a header template. */
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)(?::([a-zA-Z][a-zA-Z0-9]*))?\}/g;

/** Fills a header template; an unknown name is an entry error (400, nothing is sent). */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const filled = template.replace(PLACEHOLDER, (_all, a: string, b: string | undefined) => {
    const first = values[a];
    if (first === undefined)
      throw errors.validation(`The connector asks for an unknown value ${a}`);
    if (b === undefined) return first;
    const second = values[b];
    if (second === undefined)
      throw errors.validation(`The connector asks for an unknown value ${b}`);
    return Buffer.from(`${first}:${second}`).toString('base64');
  });
  if (!safeHeaderValue(filled) || filled.length > 8000)
    throw errors.validation('A header value contains characters that are not allowed');
  return filled;
}

export type HeaderAuth = Extract<ConnectorAuth, { type: 'api_key' | 'credentials' }>;

/** The headers an api_key or credentials entry sends, from the stored values. */
export function buildHeaders(
  auth: HeaderAuth,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const list = auth.type === 'api_key' ? [auth.header] : auth.headers;
  const out: Record<string, string> = {};
  for (const header of list) {
    if (headerNameProblem(header.name))
      throw errors.validation('The connector asks for a header that is not allowed');
    out[header.name] = fillTemplate(header.value, values);
  }
  return out;
}

/** `{field}` in the entry's MCP address, from the non-secret fields (safe characters only). */
export function fillUrl(template: string, fields: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_all, id: string) => {
    const value = fields[id];
    if (value === undefined || !URL_FIELD.test(value))
      throw errors.validation(`${id} may contain only letters, digits, dots and dashes`);
    return value;
  });
}

export interface CheckedCredentials {
  /** Secret values (encrypted at rest). */
  secret: Record<string, string>;
  /** Non-secret fields (shown again, may fill the address). */
  fields: Record<string, string>;
  /** The last 4 characters of the key or the first secret field. */
  keyEnd: string | null;
}

/** Checks what the admin entered for an api_key or credentials entry. */
export function checkCredentials(
  auth: HeaderAuth,
  given: Readonly<Record<string, string>>,
): CheckedCredentials {
  if (auth.type === 'api_key') {
    const key = checkSecret(given.key, 'key');
    return { secret: { key }, fields: {}, keyEnd: key.slice(-4) };
  }
  const secret: Record<string, string> = {};
  const fields: Record<string, string> = {};
  for (const field of auth.fields) {
    const value = checkField(given[field.id], field.id);
    if (field.secret) secret[field.id] = value;
    else fields[field.id] = value;
  }
  const first = auth.fields.find((field) => field.secret);
  return { secret, fields, keyEnd: first ? secret[first.id]!.slice(-4) : null };
}
