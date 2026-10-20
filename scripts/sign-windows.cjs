// Windows code signing for electron-builder (win.signtoolOptions.sign in apps/desktop/electron-builder.yml).
// electron-builder calls it for every file it signs (app exe, helpers, uninstaller, installer).
//
// Off unless WIN_SIGN_MODE is set, so builds without a certificate stay unsigned (as today):
//   WIN_SIGN_MODE=signtool  WIN_CERT_SHA1=<thumbprint>  [WIN_TIMESTAMP_URL=<rfc3161 url>]
//     a certificate in the Windows certificate store: Certum SimplySign (cloud, signed in) or a USB token.
//     Needs signtool.exe (Windows SDK) on PATH or in SIGNTOOL_PATH.
//   WIN_SIGN_MODE=command   WIN_SIGN_COMMAND="<tool> ... {file}"
//     any vendor tool (SSL.com CodeSignTool, jsign, ...); {file} is replaced by the quoted file path.
//     Secrets stay in that tool's own environment variables, never in this repository.
//   WIN_SIGN_MODE=azure     SIGNTOOL_PATH  AZURE_SIGN_DLIB  AZURE_SIGN_METADATA
//     Azure Artifact Signing through signtool's dlib plugin; scripts/azure-sign.mjs sets these three
//     (the login comes from AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET, read by the dlib).
// Any signing error fails the build: a release is never half signed.
'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this hook as CommonJS */
const { spawnSync } = require('node:child_process');

const DEFAULT_TIMESTAMP_URL = 'http://time.certum.pl';
const AZURE_TIMESTAMP_URL = 'http://timestamp.acs.microsoft.com';

/** The command for one file, or null when signing is off. Pure (tested). */
function signCommand(file, env = process.env) {
  const mode = (env.WIN_SIGN_MODE || '').trim();
  if (!mode) return null;
  if (mode === 'signtool') {
    const sha1 = (env.WIN_CERT_SHA1 || '').replace(/\s/g, '');
    if (!/^[0-9a-fA-F]{40}$/.test(sha1))
      throw new Error('WIN_CERT_SHA1 must be the 40-hex thumbprint');
    return {
      cmd: env.SIGNTOOL_PATH || 'signtool.exe',
      args: [
        'sign',
        '/sha1',
        sha1,
        '/fd',
        'sha256',
        '/tr',
        env.WIN_TIMESTAMP_URL || DEFAULT_TIMESTAMP_URL,
        '/td',
        'sha256',
        file,
      ],
      shell: false,
    };
  }
  if (mode === 'azure') {
    for (const name of ['SIGNTOOL_PATH', 'AZURE_SIGN_DLIB', 'AZURE_SIGN_METADATA'])
      if (!(env[name] || '').trim()) throw new Error(`azure signing needs ${name}`);
    return {
      cmd: env.SIGNTOOL_PATH,
      args: [
        'sign',
        '/v',
        '/fd',
        'SHA256',
        '/tr',
        AZURE_TIMESTAMP_URL,
        '/td',
        'SHA256',
        '/dlib',
        env.AZURE_SIGN_DLIB,
        '/dmdf',
        env.AZURE_SIGN_METADATA,
        file,
      ],
      shell: false,
    };
  }
  if (mode === 'command') {
    const template = env.WIN_SIGN_COMMAND || '';
    if (!template.includes('{file}')) throw new Error('WIN_SIGN_COMMAND must contain {file}');
    if (/["`$]/.test(file)) throw new Error('unexpected characters in the file path');
    return { cmd: template.replaceAll('{file}', `"${file}"`), args: [], shell: true };
  }
  throw new Error(`unknown WIN_SIGN_MODE ${mode} (signtool, azure or command)`);
}

/** electron-builder custom sign hook. */
async function sign(configuration) {
  const command = signCommand(configuration.path);
  if (!command) return;
  const r = spawnSync(command.cmd, command.args, { stdio: 'inherit', shell: command.shell });
  if (r.status !== 0)
    throw new Error(`signing failed (exit ${r.status}) for ${configuration.path}`);
}

module.exports = sign;
module.exports.default = sign;
module.exports.signCommand = signCommand;
