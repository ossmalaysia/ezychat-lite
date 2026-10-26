// A self-signed TLS certificate for 127.0.0.1 / localhost, made with node:crypto only (a tiny DER
// writer). TEST ONLY: ported from the Enterprise connector-testkit (packages/connector-testkit/src/cert.ts).
import { X509Certificate, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const octets = (b) => tlv(0x04, b);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const bitString = (b) => tlv(0x03, Buffer.from([0]), b);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));

function oid(dotted) {
  const [a = 0, b = 0, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    let v = n >>> 7;
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function utcTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  const s =
    p(d.getUTCFullYear() % 100) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    'Z';
  return tlv(0x17, Buffer.from(s, 'ascii'));
}

const pem = (label, der) =>
  `-----BEGIN ${label}-----\n${der
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .trimEnd()}\n-----END ${label}-----\n`;

/** A new EC P-256 self-signed certificate valid for 127.0.0.1, ::1 and localhost for `days`. */
export function generateSelfSignedCert(days = 30) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const name = seq(set(seq(oid('2.5.4.3'), utf8('EzyChat partner MCP test server'))));
  const serial = randomBytes(16);
  // DER INTEGER: positive and minimal.
  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x40;
  const now = Date.now();
  const san = seq(
    tlv(0x87, Buffer.from([127, 0, 0, 1])),
    tlv(0x87, Buffer.concat([Buffer.alloc(15), Buffer.from([1])])),
    tlv(0x82, Buffer.from('localhost', 'ascii')),
  );
  const extensions = tlv(
    0xa3,
    seq(
      seq(oid('2.5.29.19'), bool(true), octets(seq(bool(true)))),
      seq(oid('2.5.29.17'), octets(san)),
      seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))),
    ),
  );
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, serial),
    ecdsaSha256,
    name,
    seq(utcTime(new Date(now - 60 * 60_000)), utcTime(new Date(now + days * 86_400_000))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const cert = pem('CERTIFICATE', seq(tbs, ecdsaSha256, bitString(signature)));
  return { cert, key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}

/**
 * Reuses `cert.pem`/`key.pem` in `dir` while they are valid for at least another day (so a Dev
 * Build started with NODE_EXTRA_CA_CERTS=<dir>/cert.pem keeps trusting restarts); otherwise writes
 * a new pair.
 */
export function loadOrCreateCert(dir) {
  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.pem');
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const cert = readFileSync(certPath, 'utf8');
      const x = new X509Certificate(cert);
      if (Date.parse(x.validTo) - Date.now() > 86_400_000 && x.checkIP('127.0.0.1'))
        return { cert, key: readFileSync(keyPath, 'utf8'), certPath };
    } catch {
      // unreadable or not ours: replace it
    }
  }
  mkdirSync(dir, { recursive: true });
  const fresh = generateSelfSignedCert();
  writeFileSync(certPath, fresh.cert);
  writeFileSync(keyPath, fresh.key, { mode: 0o600 });
  return { ...fresh, certPath };
}
