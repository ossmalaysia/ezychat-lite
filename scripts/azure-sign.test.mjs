import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TOOLS,
  azureMetadata,
  azureSignEnv,
  azureSignSettings,
  githubEnvLines,
  hasDotnet8,
} from './azure-sign.mjs';

const full = {
  AZURE_SIGN_ENDPOINT: 'https://jpe.codesigning.azure.net/',
  AZURE_SIGN_ACCOUNT: 'anchorsprint-signing',
  AZURE_SIGN_PROFILE: 'ezychat-public',
  AZURE_SIGN_PUBLISHER: 'Anchor Sprint Pte. Ltd.',
  AZURE_TENANT_ID: 'tenant',
  AZURE_CLIENT_ID: 'client',
  AZURE_CLIENT_SECRET: 'secret',
};

describe('Azure signing switch', () => {
  it('is off when Azure signing is not configured (build unchanged, nothing downloaded)', async () => {
    expect(azureSignSettings({})).toBeNull();
    expect(await azureSignEnv({})).toEqual({});
  });

  it('writes only the account details into metadata.json, never the login secret', () => {
    const metadata = azureMetadata(azureSignSettings(full));
    expect(metadata).toEqual({
      Endpoint: 'https://jpe.codesigning.azure.net/',
      CodeSigningAccountName: 'anchorsprint-signing',
      CertificateProfileName: 'ezychat-public',
      ExcludeCredentials: ['ManagedIdentityCredential'],
    });
    expect(JSON.stringify(metadata)).not.toContain('secret');
  });

  it('pins every download to an official Microsoft host and a full hash', () => {
    for (const tool of Object.values(TOOLS)) {
      expect(new URL(tool.url).hostname).toMatch(
        /^(api\.nuget\.org|builds\.dotnet\.microsoft\.com)$/,
      );
      expect(tool.sha256 ?? tool.sha512).toMatch(
        tool.sha256 ? /^[0-9a-f]{64}$/ : /^[0-9a-f]{128}$/,
      );
    }
  });

  it('finds a machine-wide .NET 8 runtime and ignores other versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'dotnet-'));
    try {
      const shared = join(root, 'dotnet', 'shared', 'Microsoft.NETCore.App');
      expect(hasDotnet8(root)).toBe(false);
      mkdirSync(join(shared, '9.0.3'), { recursive: true });
      expect(hasDotnet8(root)).toBe(false);
      mkdirSync(join(shared, '8.0.10'));
      expect(hasDotnet8(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['half configured', { AZURE_SIGN_ACCOUNT: 'x' }, 'half configured'],
    [
      'a non-Azure endpoint',
      { ...full, AZURE_SIGN_ENDPOINT: 'https://evil.example/' },
      'codesigning.azure.net',
    ],
    ['no login secret', { ...full, AZURE_CLIENT_SECRET: '' }, 'AZURE_CLIENT_SECRET'],
    ['an unknown login', { ...full, AZURE_SIGN_LOGIN: 'browser' }, 'azure-cli'],
  ])('refuses %s', (_label, env, message) => {
    expect(() => azureSignSettings(env)).toThrow(message);
  });

  it('accepts the Azure CLI login (GitHub OIDC) without any stored secret', () => {
    const oidc = {
      AZURE_SIGN_ENDPOINT: full.AZURE_SIGN_ENDPOINT,
      AZURE_SIGN_ACCOUNT: full.AZURE_SIGN_ACCOUNT,
      AZURE_SIGN_PROFILE: full.AZURE_SIGN_PROFILE,
      AZURE_SIGN_PUBLISHER: full.AZURE_SIGN_PUBLISHER,
      AZURE_SIGN_LOGIN: 'azure-cli',
    };
    expect(azureSignSettings(oidc)).toMatchObject({ account: 'anchorsprint-signing' });
  });
});

describe('GitHub job environment', () => {
  it('writes one KEY=value line per variable', () => {
    expect(githubEnvLines({ WIN_SIGN_MODE: 'azure', SIGNTOOL_PATH: 'C:\\t\\signtool.exe' })).toBe(
      'WIN_SIGN_MODE=azure\nSIGNTOOL_PATH=C:\\t\\signtool.exe\n',
    );
  });

  it('refuses a value with a line break (it could add a variable)', () => {
    expect(() => githubEnvLines({ A: 'x\nNODE_OPTIONS=--require evil' })).toThrow('line break');
  });
});
