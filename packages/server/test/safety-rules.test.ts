import { describe, expect, it } from 'vitest';
import { checkMessage, isDisguisedName, isLookalikeLink, magicOf } from '../src/safety/rules.js';
import { listZip } from '../src/safety/zip.js';
import { decide, shouldAutoBlock } from '../src/safety/policy.js';

/** A minimal ZIP (stored entries) with an optional encrypted flag per entry and a broken variant. */
function makeZip(entries: Array<{ name: string; encrypted?: boolean; utf8?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, e.utf8 ? 'utf8' : 'latin1');
    const flags = (e.encrypted ? 0x1 : 0) | (e.utf8 ? 0x800 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length;
  }
  const dir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, eocd]);
}

const file = (name: string, bytes: Buffer | null, mime = 'application/octet-stream') => ({
  name,
  mime,
  bytes,
});
const base = { text: null, file: null, firstFile: false, scamNumber: false };

describe('listZip', () => {
  it('lists the names and the password flag without extracting anything', () => {
    const zip = makeZip([{ name: 'docs/a.pdf' }, { name: 'b.vbs', encrypted: true }]);
    expect(listZip(zip)).toEqual({
      ok: true,
      truncated: false,
      entries: [
        { name: 'docs/a.pdf', encrypted: false },
        { name: 'b.vbs', encrypted: true },
      ],
    });
  });

  it('reads UTF-8 names', () => {
    expect(listZip(makeZip([{ name: '对账单.pdf.js', utf8: true }])).entries[0]!.name).toBe(
      '对账单.pdf.js',
    );
  });

  it('stops at the entry cap and says so', () => {
    const zip = makeZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt` })));
    const listing = listZip(zip, 3);
    expect(listing.entries).toHaveLength(3);
    expect(listing.truncated).toBe(true);
  });

  it('answers ok: false for a broken, truncated or ZIP64 archive instead of throwing', () => {
    expect(listZip(Buffer.from('not a zip at all, just text bytes')).ok).toBe(false);
    expect(listZip(Buffer.alloc(5)).ok).toBe(false);
    const zip = makeZip([{ name: 'a.pdf' }]);
    // Central directory points past the end-of-directory record.
    const bad = Buffer.from(zip);
    bad.writeUInt32LE(0xffff, bad.length - 22 + 16);
    expect(listZip(bad).ok).toBe(false);
    // ZIP64 marker in the entry count.
    const z64 = Buffer.from(zip);
    z64.writeUInt16LE(0xffff, z64.length - 22 + 10);
    expect(listZip(z64).ok).toBe(false);
    // Signature of the first central entry overwritten.
    const sig = Buffer.from(zip);
    sig.writeUInt32LE(0, zip.length - 22 - (46 + 5));
    expect(listZip(sig).ok).toBe(false);
    // An entry name longer than the directory.
    const long = Buffer.from(zip);
    long.writeUInt16LE(500, zip.length - 22 - (46 + 5) + 28);
    expect(listZip(long).ok).toBe(false);
  });
});

describe('names and magic bytes', () => {
  it('spots fake double extensions and bidi tricks, not ordinary names', () => {
    expect(isDisguisedName('Statement_of_Account.pdf.vbs')).toBe(true);
    expect(isDisguisedName('invoice.pdf   .exe')).toBe(true);
    expect(isDisguisedName('photo‮gpj.exe')).toBe(true);
    expect(isDisguisedName('report.final.pdf')).toBe(false);
    expect(isDisguisedName('setup.exe')).toBe(false);
  });

  it('reads the real type from the first bytes', () => {
    expect(magicOf(Buffer.from('MZ\x90\x00', 'latin1'))).toBe('pe');
    expect(magicOf(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).toBe('elf');
    expect(magicOf(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe('macho');
    expect(magicOf(makeZip([{ name: 'a' }]))).toBe('zip');
    expect(magicOf(Buffer.from('Rar!\x1a\x07\x00', 'latin1'))).toBe('rar');
    expect(magicOf(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe('7z');
    expect(magicOf(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('ole');
    expect(magicOf(Buffer.from([0x4c, 0, 0, 0, 1, 2]))).toBe('lnk');
    expect(magicOf(Buffer.from('#!/bin/sh\n'))).toBe('script');
    const iso = Buffer.alloc(0x8010);
    iso.write('CD001', 0x8001, 'latin1');
    expect(magicOf(iso)).toBe('iso');
    expect(magicOf(Buffer.from('%PDF-1.7'))).toBe(null);
  });
});

describe('checkMessage', () => {
  it('flags the statement-of-account ZIP lure: program inside, fake PDF, finance wording, "open on laptop"', () => {
    const rules = checkMessage({
      ...base,
      firstFile: true,
      text: 'Please forward this statement of account to your finance manager. Kindly open it on a laptop or desktop.',
      file: file('Statement_Oct2026.zip', makeZip([{ name: 'Statement_Oct2026.pdf.vbs' }])),
    });
    expect(rules).toEqual(['exeInZip', 'openOnComputer', 'financeUrgency', 'firstFile']);
    expect(decide(rules, null)).toMatchObject({ critical: true, level: 'high' });
  });

  it('flags a program by its bytes even when it is named like a PDF', () => {
    expect(
      checkMessage({ ...base, file: file('invoice.pdf', Buffer.from('MZ\x90\x00', 'latin1')) }),
    ).toEqual(['executable']);
  });

  it('flags a fake double extension and a risky extension without the bytes', () => {
    expect(checkMessage({ ...base, file: file('Payment_Slip.pdf.js', null) })).toEqual([
      'executable',
      'doubleExtension',
    ]);
  });

  it('cannot look inside RAR, 7z, password ZIPs, ZIPs inside ZIPs, broken or not-downloaded ZIPs', () => {
    const one = (f: ReturnType<typeof file>) => checkMessage({ ...base, file: f });
    expect(one(file('q.rar', Buffer.from('Rar!\x1a\x07\x00', 'latin1')))).toEqual(['cantInspect']);
    expect(one(file('q.7z', null))).toEqual(['cantInspect']);
    expect(one(file('q.zip', makeZip([{ name: 'a.pdf', encrypted: true }])))).toEqual([
      'cantInspect',
    ]);
    expect(one(file('q.zip', makeZip([{ name: 'inner.zip' }])))).toEqual(['cantInspect']);
    expect(one(file('q.zip', Buffer.from('PK\x03\x04garbage', 'latin1')))).toEqual(['cantInspect']);
    expect(one(file('q.zip', null))).toEqual(['cantInspect']);
  });

  it('does not open Office files, APKs or JARs as archives, and a ZIP of documents is fine', () => {
    const docx = makeZip([{ name: 'word/document.xml' }]);
    expect(checkMessage({ ...base, file: file('quote.docx', docx) })).toEqual([]);
    expect(checkMessage({ ...base, file: file('app.apk', docx) })).toEqual(['executable']);
    expect(
      checkMessage({ ...base, file: file('photos.zip', makeZip([{ name: 'a.jpg' }])) }),
    ).toEqual([]);
  });

  it('flags macro files by extension, inside a ZIP and in old Office files', () => {
    expect(checkMessage({ ...base, file: file('Order.xlsm', null) })).toEqual(['macroFile']);
    expect(
      checkMessage({ ...base, file: file('o.zip', makeZip([{ name: 'Order.docm' }])) }),
    ).toEqual(['macroFile']);
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.from('xxV\0B\0A\0xx', 'latin1'),
    ]);
    expect(checkMessage({ ...base, file: file('old.doc', ole) })).toEqual(['macroFile']);
    expect(
      checkMessage({
        ...base,
        file: file('old.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
      }),
    ).toEqual([]);
  });

  it('flags a shell script by its first bytes but not a text file that starts with #!', () => {
    expect(checkMessage({ ...base, file: file('run', Buffer.from('#!/bin/sh')) })).toEqual([
      'executable',
    ]);
    expect(checkMessage({ ...base, file: file('notes.txt', Buffer.from('#!hello')) })).toEqual([]);
  });

  it('flags lookalike, shortened, IP and punycode links, not real bank links', () => {
    expect(isLookalikeLink('https://maybank2u-secure.my-verify.top/login')).toBe(true);
    expect(isLookalikeLink('https://www.maybank2u.com.my/home')).toBe(false);
    expect(isLookalikeLink('https://bit.ly/3abc')).toBe(true);
    expect(isLookalikeLink('http://203.0.113.9/pay')).toBe(true);
    expect(isLookalikeLink('https://xn--mybank-4ya.com')).toBe(true);
    expect(isLookalikeLink('https://kopiapong.com.my/menu')).toBe(false);
    expect(isLookalikeLink('http://')).toBe(false);
    const rules = checkMessage({
      ...base,
      text: 'Maybank2u: Your account is suspended. Verify at https://maybank2u-secure.my-verify.top/login urgently for payment',
    });
    expect(rules).toEqual(['lookalikeLink', 'financeUrgency']);
    expect(decide(rules, null).level).toBe('warning');
  });

  it('reads Malay and Chinese lures and a password sent with a file', () => {
    expect(
      checkMessage({ ...base, text: 'Sila hantar penyata akaun ini, buka di laptop.' }),
    ).toEqual(['openOnComputer', 'financeUrgency']);
    expect(checkMessage({ ...base, text: '请把对账单转给财务部，用电脑打开' })).toEqual([
      'openOnComputer',
      'financeUrgency',
    ]);
    expect(checkMessage({ ...base, text: 'Quotation attached. Password: 2026' })).toEqual([
      'passwordInMessage',
    ]);
    expect(checkMessage({ ...base, text: '文件密码：8899' })).toEqual(['passwordInMessage']);
  });

  it('leaves ordinary messages alone and adds "first file" only next to another finding', () => {
    expect(checkMessage({ ...base, text: 'Can I book catering for 30 people?' })).toEqual([]);
    expect(
      checkMessage({ ...base, firstFile: true, file: file('menu.pdf', Buffer.from('%PDF')) }),
    ).toEqual([]);
  });

  it('flags anything from a number the team reported', () => {
    expect(checkMessage({ ...base, scamNumber: true, text: 'hello' })).toEqual(['scamNumber']);
  });
});

describe('decide and auto-block', () => {
  const ai = (level: 'none' | 'warning' | 'high') => ({
    level,
    category: 'none' as const,
    reason: '',
  });

  it('scores the rules: Warning at 30, High at 60', () => {
    expect(decide(['financeUrgency'], null)).toEqual({
      score: 20,
      ruleLevel: 'none',
      critical: false,
      level: 'none',
    });
    expect(decide(['macroFile'], null).level).toBe('warning');
    expect(decide(['cantInspect', 'passwordInMessage'], null).level).toBe('high');
  });

  it('lets the AI raise or confirm, lower only a rules-only Warning, never a critical or High result', () => {
    expect(decide(['financeUrgency'], ai('high')).level).toBe('high');
    expect(decide(['macroFile'], ai('none')).level).toBe('none');
    expect(decide(['macroFile'], ai('warning')).level).toBe('warning');
    expect(decide(['exeInZip'], ai('none')).level).toBe('high');
    expect(decide(['cantInspect', 'passwordInMessage'], ai('none')).level).toBe('high');
  });

  it('auto-blocks only a live critical message from a new number outside groups, when switched on', () => {
    const critical = decide(['exeInZip'], null);
    const yes = {
      enabled: true,
      decision: critical,
      existingCustomer: false,
      group: false,
      live: true,
    };
    expect(shouldAutoBlock(yes)).toBe(true);
    expect(shouldAutoBlock({ ...yes, enabled: false })).toBe(false);
    expect(shouldAutoBlock({ ...yes, existingCustomer: true })).toBe(false);
    expect(shouldAutoBlock({ ...yes, group: true })).toBe(false);
    expect(shouldAutoBlock({ ...yes, live: false })).toBe(false);
    expect(
      shouldAutoBlock({ ...yes, decision: decide(['cantInspect', 'passwordInMessage'], null) }),
    ).toBe(false);
  });
});
