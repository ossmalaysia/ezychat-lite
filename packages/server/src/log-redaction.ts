/** Shared by live logging and support exports, including logs written before redaction existed. */
const SECRET_FIELDS = [
  'password',
  'token',
  'apiToken',
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
];

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
