// Starts the partner MCP test server and prints its endpoints, test credentials and the env lines
// a Dev Build needs. TEST ONLY.
//
//   node e2e/partner-mcp/cli.mjs [--port 7610] [--ttl <seconds>] [--control-token <token>] [--quiet]
//
// The certificate and the list signing key are kept in <tmp>/ezychat-partner-mcp (a fixed folder),
// so a Dev Build keeps trusting restarts. Switch an endpoint while running:
//   POST <origin>/_control  Authorization: Bearer <control token>  {"endpoint":"oauth","state":"down"}
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadOrCreateCert } from './cert.mjs';
import { createListKeys } from './list.mjs';
import { ENDPOINTS, PARTNER_CREDENTIALS, startPartnerMcp } from './server.mjs';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '7610' },
    ttl: { type: 'string', default: '300' },
    'control-token': { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});

// A fixed folder: no path ever comes from the command line.
const DIR = join(tmpdir(), 'ezychat-partner-mcp');
const givenToken = values['control-token'];
if (givenToken !== undefined && !/^[\w-]{8,64}$/.test(givenToken)) {
  console.error('--control-token must be 8 to 64 letters, digits, _ or -.');
  process.exit(2);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535 || port === 7420) {
  console.error('--port must be a free port other than 7420 (the app).');
  process.exit(2);
}

/** The list signing key, kept in the folder so the app's test key stays the same. */
function loadOrCreateListKeys(dir) {
  const path = join(dir, 'list-key.pem');
  if (existsSync(path)) {
    const privateKey = createPrivateKey(readFileSync(path, 'utf8'));
    const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
    return { privateKey, publicKeyBase64: Buffer.from(raw).toString('base64') };
  }
  mkdirSync(dir, { recursive: true });
  const keys = createListKeys();
  writeFileSync(path, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  return keys;
}

const cert = loadOrCreateCert(DIR);
const kit = await startPartnerMcp({
  port,
  tls: cert,
  accessTokenTtlSeconds: Number(values.ttl),
  controlToken: givenToken,
  list: loadOrCreateListKeys(DIR),
  log: values.quiet ? undefined : (line) => console.log(`[partner-mcp] ${line}`),
});

const env = [
  'CONNECTORS_TEST_ALLOW_LOCAL=1',
  `NODE_EXTRA_CA_CERTS=${cert.certPath}`,
  `EZYCHAT_CONNECTOR_LIST_URL=${kit.listBaseUrl}`,
  `EZYCHAT_CONNECTOR_LIST_TEST_KEY=${kit.listPublicKey}`,
];
writeFileSync(join(DIR, 'env.txt'), env.join('\n') + '\n');

console.log(
  [
    `EzyChat partner MCP test server on ${kit.origin} (127.0.0.1 only, demo data)`,
    '',
    ...ENDPOINTS.map((e) => `  ${e.padEnd(14)} ${kit.url(e)}`),
    '',
    `  api_key       key ${PARTNER_CREDENTIALS.apiKey}`,
    `  credentials   account ${PARTNER_CREDENTIALS.account}, username ${PARTNER_CREDENTIALS.username}, password ${PARTNER_CREDENTIALS.password}`,
    `  oauth         sign in on the test page (automatic registration); click Allow`,
    `  oauth_own_app client ID ${PARTNER_CREDENTIALS.clientId}, secret ${PARTNER_CREDENTIALS.clientSecret}`,
    '',
    `Signed test list: ${kit.listUrl} (+ .sig, icons/)`,
    // A token given on the command line is not printed back.
    `Control: POST ${kit.origin}/_control  Authorization: Bearer ${givenToken === undefined ? kit.controlToken : '<your --control-token>'}`,
    '',
    `Start the app with (also in ${join(DIR, 'env.txt')}):`,
    ...env.map((line) => `  ${line}`),
  ].join('\n'),
);

const stop = () => void kit.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
