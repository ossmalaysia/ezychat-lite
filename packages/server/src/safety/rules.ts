import type { SafetyRule } from '@ezychat/shared';
import { listZip } from './zip.js';

/**
 * WhatsApp Safety's local rules: what a message's file and text show, read from the file's first
 * bytes, the ZIP's file list and the text. A file is never run, opened or extracted here.
 */

export interface SafetyInput {
  text: string | null;
  file: {
    name: string | null;
    mime: string;
    /** The file's bytes; null when it is not downloaded or too large (name and type only). */
    bytes: Buffer | null;
  } | null;
  /** This number never sent a file before. */
  firstFile: boolean;
  /** The team reported this number as a scam. */
  scamNumber: boolean;
}

/** Files that run code when opened. */
const RISKY_EXT = new Set([
  'exe',
  'msi',
  'scr',
  'com',
  'pif',
  'cpl',
  'dll',
  'bat',
  'cmd',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'ps1',
  'psm1',
  'hta',
  'lnk',
  'reg',
  'jar',
  'apk',
  'xapk',
  'iso',
  'img',
  'vhd',
  'vhdx',
  'msix',
  'appx',
  'sh',
  'command',
  'app',
  'pkg',
  'dmg',
  'url',
  'chm',
  'inf',
  'scf',
]);
/** What a lure pretends to be. */
const DOC_EXT = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'jpg',
  'jpeg',
  'png',
  'csv',
  'rtf',
  'zip',
]);
const MACRO_EXT = new Set(['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppsm']);
const ARCHIVE_UNREADABLE_EXT = new Set([
  'rar',
  '7z',
  'cab',
  'arj',
  'ace',
  'gz',
  'tgz',
  'bz2',
  'xz',
]);

/** Right-to-left override and similar controls that make `exe.pdf` show as `fdp.exe`. */
const BIDI = /[‪-‮⁦-⁩‎‏]/;

const ext = (name: string) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : '';
};

/** `Statement.pdf.vbs`, `invoice.pdf   .exe`, or a name that hides its real end with bidi controls. */
export function isDisguisedName(name: string): boolean {
  if (BIDI.test(name)) return true;
  const parts = name.toLowerCase().replace(/\s+/g, '').split('.');
  if (parts.length < 3) return false;
  return RISKY_EXT.has(parts.at(-1)!) && DOC_EXT.has(parts.at(-2)!);
}

type Magic =
  'pe' | 'elf' | 'macho' | 'zip' | 'rar' | '7z' | 'ole' | 'lnk' | 'iso' | 'script' | null;

/** The real type from the first bytes, whatever the name says. */
export function magicOf(b: Buffer): Magic {
  if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) return 'pe';
  if (b.length >= 4 && b.readUInt32BE(0) === 0x7f454c46) return 'elf';
  if (
    b.length >= 4 &&
    [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(b.readUInt32BE(0))
  )
    return 'macho';
  if (b.length >= 4 && b.readUInt32LE(0) === 0x04034b50) return 'zip';
  if (b.length >= 4 && b.readUInt32LE(0) === 0x06054b50) return 'zip';
  if (b.length >= 6 && b.subarray(0, 6).toString('latin1') === 'Rar!\x1a\x07') return 'rar';
  if (b.length >= 6 && b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])))
    return '7z';
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  )
    return 'ole';
  if (b.length >= 4 && b.readUInt32LE(0) === 0x0000004c) return 'lnk';
  if (b.length >= 0x8006 && b.subarray(0x8001, 0x8006).toString('latin1') === 'CD001') return 'iso';
  if (b.length >= 2 && b[0] === 0x23 && b[1] === 0x21) return 'script';
  return null;
}

/** Office files that are ZIPs inside (docx, xlsx, apk, jar…) are not "archives" to the reader. */
const ZIP_CONTAINER_EXT = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub']);

function fileRules(file: NonNullable<SafetyInput['file']>, out: Set<SafetyRule>): void {
  const name = file.name ?? '';
  const e = ext(name);
  if (name && isDisguisedName(name)) out.add('doubleExtension');
  if (RISKY_EXT.has(e)) out.add('executable');
  if (MACRO_EXT.has(e)) out.add('macroFile');
  const magic = file.bytes ? magicOf(file.bytes) : null;
  if (magic === 'pe' || magic === 'elf' || magic === 'macho' || magic === 'lnk' || magic === 'iso')
    out.add('executable');
  if (magic === 'script' && !['txt', 'csv'].includes(e)) out.add('executable');
  if (magic === 'rar' || magic === '7z' || (!magic && ARCHIVE_UNREADABLE_EXT.has(e)))
    out.add('cantInspect');
  const zipLike = magic === 'zip' || (!file.bytes && e === 'zip');
  if (zipLike && !ZIP_CONTAINER_EXT.has(e) && !['apk', 'jar', 'xapk', 'msix', 'appx'].includes(e)) {
    if (!file.bytes) {
      out.add('cantInspect');
      return;
    }
    const listing = listZip(file.bytes);
    if (!listing.ok) {
      out.add('cantInspect');
      return;
    }
    for (const entry of listing.entries) {
      const base = entry.name.split('/').at(-1) ?? entry.name;
      if (RISKY_EXT.has(ext(base)) || isDisguisedName(base)) out.add('exeInZip');
      if (MACRO_EXT.has(ext(base))) out.add('macroFile');
      if (ext(base) === 'zip' || ARCHIVE_UNREADABLE_EXT.has(ext(base))) out.add('cantInspect');
    }
    if (listing.entries.some((x) => x.encrypted)) out.add('cantInspect');
  }
  if (magic === 'ole' && ['doc', 'xls', 'ppt'].includes(e)) {
    // Old Office files: macros live in a "VBA" storage; its name is in the file's directory.
    if (file.bytes!.includes(Buffer.from('V\0B\0A\0', 'latin1'))) out.add('macroFile');
  }
}

const FINANCE = [
  /statement of accounts?/i,
  /\b(soa|remittance|payment slip|proof of payment|purchase order|overdue invoice)\b/i,
  /forward (it |this )?to (your )?(finance|account(s|ing)?)/i,
  /\burgent(ly)?\b.*\b(payment|transfer|invoice|account)\b/i,
  /\b(payment|transfer|invoice)\b.*\burgent(ly)?\b/i,
  /penyata akaun|bayaran segera|slip bayaran|pesanan belian|bahagian kewangan/i,
  /对账单|付款单|汇款|采购订单|财务部|紧急付款|发票逾期/,
];
const OPEN_ON_COMPUTER =
  /(open|view|download)\b[^.\n]{0,40}\b(on|using|with) (a |your )?(laptop|desktop|computer|pc)\b|buka (di|guna|menggunakan) (laptop|komputer|pc)|(用|在)电脑(上)?(打开|查看)/i;
const PASSWORD =
  /\b(password|passcode|pwd|kata laluan|katalaluan)\b\s*[:=：]?\s*\S+|密码\s*[:：]?\s*\S+/i;
const LINK = /\bhttps?:\/\/[^\s<>"')]+|\b(?:www\.)[^\s<>"')]+/gi;
const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  's.id',
  't.ly',
  'cutt.ly',
  'is.gd',
  'rb.gy',
  'shorturl.at',
  'ow.ly',
  'tiny.cc',
  'rebrand.ly',
  'shorturl.asia',
  'v.gd',
  'qr.co',
  't.co',
]);
/** Brand word → domains it really uses. A host naming the brand anywhere else is a lookalike. */
const BRANDS: Record<string, string[]> = {
  maybank: ['maybank2u.com.my', 'maybank.com', 'maybank.com.my'],
  cimb: ['cimb.com.my', 'cimbclicks.com.my', 'cimb.com'],
  publicbank: ['pbebank.com', 'publicbank.com.my'],
  pbebank: ['pbebank.com'],
  rhb: ['rhbgroup.com', 'rhbnow.com.my'],
  hongleong: ['hlb.com.my', 'hongleong.com.my'],
  ambank: ['ambank.com.my', 'ambankgroup.com'],
  bankislam: ['bankislam.com', 'bankislam.biz'],
  touchngo: ['touchngo.com.my', 'tngdigital.com.my'],
  lhdn: ['hasil.gov.my'],
  hasil: ['hasil.gov.my'],
  pos: ['pos.com.my'],
  jpj: ['jpj.gov.my'],
  pdrm: ['rmp.gov.my'],
  whatsapp: ['whatsapp.com', 'whatsapp.net', 'wa.me'],
  paypal: ['paypal.com'],
  shopee: ['shopee.com.my', 'shopee.sg', 'shopee.co.id'],
  lazada: ['lazada.com.my', 'lazada.sg', 'lazada.co.id'],
  dhl: ['dhl.com', 'dhl.com.my'],
};

function hostOf(raw: string): string | null {
  try {
    return new URL(raw.startsWith('http') ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A link that hides where it goes: a shortener, a bare IP, punycode, or a brand on someone else's domain. */
export function isLookalikeLink(raw: string): boolean {
  const host = hostOf(raw);
  if (!host) return false;
  if (SHORTENERS.has(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return true;
  if (host.split('.').some((label) => label.startsWith('xn--'))) return true;
  const flat = host.replace(/[-.]/g, '');
  for (const [brand, domains] of Object.entries(BRANDS))
    if (flat.includes(brand) && !domains.some((d) => host === d || host.endsWith(`.${d}`)))
      return true;
  return false;
}

function textRules(text: string, out: Set<SafetyRule>): void {
  if (FINANCE.some((r) => r.test(text))) out.add('financeUrgency');
  if (OPEN_ON_COMPUTER.test(text)) out.add('openOnComputer');
  if (PASSWORD.test(text)) out.add('passwordInMessage');
  for (const m of text.matchAll(LINK))
    if (isLookalikeLink(m[0])) {
      out.add('lookalikeLink');
      break;
    }
}

/** Order: critical findings first, so the chat shows the most important two. */
const ORDER: SafetyRule[] = [
  'scamNumber',
  'exeInZip',
  'executable',
  'doubleExtension',
  'lookalikeLink',
  'cantInspect',
  'macroFile',
  'passwordInMessage',
  'openOnComputer',
  'financeUrgency',
  'firstFile',
];

/** Every rule the message triggers, most important first; empty = nothing found. */
export function checkMessage(input: SafetyInput): SafetyRule[] {
  const out = new Set<SafetyRule>();
  if (input.file) fileRules(input.file, out);
  if (input.text) textRules(input.text.slice(0, 4000), out);
  // A number the team reported is flagged whatever it sends.
  if (input.scamNumber) out.add('scamNumber');
  if (out.size === 0) return [];
  if (input.file && input.firstFile) out.add('firstFile');
  return ORDER.filter((r) => out.has(r));
}
