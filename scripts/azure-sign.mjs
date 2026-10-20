// Azure Artifact Signing (Microsoft's managed code signing) for the Windows build. When all four settings
// below are present, our sign hook (scripts/sign-windows.cjs, WIN_SIGN_MODE=azure) signs every Windows file
// with signtool and Microsoft's Azure.CodeSigning.Dlib plugin; otherwise the build is unchanged.
// The tools come from pinned NuGet packages (signtool: Microsoft.Windows.SDK.BuildTools, dlib:
// Microsoft.ArtifactSigning.Client), checked by SHA-256 and cached per user, so the runner needs no install.
// The dlib needs the .NET 8 runtime: the machine-wide one when present, else a pinned runtime zip (DOTNET_ROOT).
// (Not electron-builder's azureSignOptions: its TrustedSigning PowerShell module needs the dotnet SDK and
// installs its packages again for every file, in parallel. Not the Client Tools MSI either: it installs into
// the installing user's own AppData, which the runner account cannot read.)
// The Azure login, read by the dlib itself (never passed on the command line, never logged), is either:
//   - the standard AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET variables, or
//   - AZURE_SIGN_LOGIN=azure-cli after `azure/login` with GitHub OIDC (release.yml): no stored secret,
//     which suits this public repository; the dlib then uses the Azure CLI's sign-in.
// In CI, `node scripts/azure-sign.mjs --github-env` appends the hook's variables to $GITHUB_ENV.
//   AZURE_SIGN_ENDPOINT    e.g. https://jpe.codesigning.azure.net/ (the account's region endpoint)
//   AZURE_SIGN_ACCOUNT     Artifact Signing account name
//   AZURE_SIGN_PROFILE     certificate profile name (Public Trust)
//   AZURE_SIGN_PUBLISHER   the certificate's subject CN (the Singapore company's legal name)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SETTINGS = {
  endpoint: 'AZURE_SIGN_ENDPOINT',
  account: 'AZURE_SIGN_ACCOUNT',
  profile: 'AZURE_SIGN_PROFILE',
  publisher: 'AZURE_SIGN_PUBLISHER',
};

/** Pinned downloads (update the version and hash together). */
export const TOOLS = {
  dlib: {
    url: 'https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/1.0.146/microsoft.artifactsigning.client.1.0.146.nupkg',
    sha256: '7761e5d8f31e54b764da21d33cd8b0a2940e1b05526c7dfcb5e94b0431426f70',
    dir: 'artifactsigning.client-1.0.146',
    file: ['bin', 'x64', 'Azure.CodeSigning.Dlib.dll'],
  },
  signtool: {
    url: 'https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/10.0.28000.2705/microsoft.windows.sdk.buildtools.10.0.28000.2705.nupkg',
    sha256: '8bfdfb6ca2633f531cf80b5fa22512ba61a394d7988f0970db83baadc67929ed',
    dir: 'sdk.buildtools-10.0.28000.2705',
    file: ['bin', '10.0.28000.0', 'x64', 'signtool.exe'],
  },
  dotnet: {
    url: 'https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.32/dotnet-runtime-8.0.32-win-x64.zip',
    sha512:
      'f0349e793d8081c682c01d736db695c9c1ec268c6173648913543db219e44cbf2e952c7ef94fc37946b0f2bb95ca1898d972a43591b8e44d5a1659f4911904c0',
    dir: 'dotnet-runtime-8.0.32',
    file: ['dotnet.exe'],
  },
};

/** The checked Azure settings, null when Azure signing is not configured. Pure (tested). */
export function azureSignSettings(env = process.env) {
  const values = Object.fromEntries(
    Object.entries(SETTINGS).map(([key, name]) => [key, (env[name] ?? '').trim()]),
  );
  const missing = Object.entries(values).filter(([, v]) => !v);
  if (missing.length === Object.keys(SETTINGS).length) return null;
  if (missing.length)
    throw new Error(
      `Azure signing is half configured: set ${missing.map(([k]) => SETTINGS[k]).join(', ')}`,
    );
  const endpoint = new URL(values.endpoint);
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.codesigning.azure.net'))
    throw new Error(
      'AZURE_SIGN_ENDPOINT must be an https://<region>.codesigning.azure.net/ address',
    );
  const login = (env.AZURE_SIGN_LOGIN ?? '').trim();
  if (login && login !== 'azure-cli') throw new Error('AZURE_SIGN_LOGIN must be azure-cli');
  if (!login)
    for (const name of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'])
      if (!(env[name] ?? '').trim())
        throw new Error(`Azure signing needs ${name} (or AZURE_SIGN_LOGIN=azure-cli)`);
  return values;
}

/** The dlib's metadata.json content (endpoint, account, profile). Pure (tested). */
export function azureMetadata(settings) {
  return {
    Endpoint: settings.endpoint,
    CodeSigningAccountName: settings.account,
    CertificateProfileName: settings.profile,
    // The dlib runs outside Azure: managed identity only times out there (Artifact Signing FAQ).
    ExcludeCredentials: ['ManagedIdentityCredential'],
  };
}

/** True when a machine-wide .NET 8 runtime exists under programFiles. */
export function hasDotnet8(programFiles) {
  const dir = join(programFiles, 'dotnet', 'shared', 'Microsoft.NETCore.App');
  return existsSync(dir) && readdirSync(dir).some((v) => v.startsWith('8.'));
}

/** Downloads, checks and extracts one pinned tool into cache (once); returns the tool file's path. */
async function ensureTool(tool, cache) {
  const target = join(cache, tool.dir);
  const file = join(target, ...tool.file);
  if (existsSync(file)) return file;
  const response = await fetch(tool.url);
  if (!response.ok) throw new Error(`download failed (${response.status}): ${tool.url}`);
  const data = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = tool.sha256 ? ['sha256', tool.sha256] : ['sha512', tool.sha512];
  const actual = createHash(algorithm).update(data).digest('hex');
  if (actual !== expected) throw new Error(`${algorithm} mismatch for ${tool.url}`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const archive = join(cache, `${tool.dir}.zip`);
  writeFileSync(archive, data);
  // Windows' own bsdtar reads zip files (Git's GNU tar on PATH does not).
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const r = spawnSync(tar, ['-xf', archive, '-C', target], { stdio: 'inherit' });
  rmSync(archive, { force: true });
  if (r.status !== 0 || !existsSync(file)) throw new Error(`could not extract ${tool.url}`);
  return file;
}

/**
 * Environment for the sign hook (WIN_SIGN_MODE=azure), {} when Azure signing is not configured.
 * Fetches signtool, the dlib and (only when missing) .NET 8, and writes metadata.json.
 */
export async function azureSignEnv(env = process.env) {
  const settings = azureSignSettings(env);
  if (!settings) return {};
  const system32 = join(env.SystemRoot ?? 'C:\\Windows', 'System32');
  if (!existsSync(join(system32, 'vcruntime140.dll')))
    throw new Error(
      'Azure signing needs the Microsoft Visual C++ Redistributable (x64) on this machine',
    );
  const cache = join(env.LOCALAPPDATA ?? tmpdir(), 'ezychat-signing');
  mkdirSync(cache, { recursive: true });
  const result = {
    WIN_SIGN_MODE: 'azure',
    SIGNTOOL_PATH: await ensureTool(TOOLS.signtool, cache),
    AZURE_SIGN_DLIB: await ensureTool(TOOLS.dlib, cache),
  };
  if (!hasDotnet8(env.ProgramFiles ?? 'C:\\Program Files')) {
    const dotnet = join(await ensureTool(TOOLS.dotnet, cache), '..');
    result.DOTNET_ROOT = dotnet;
    result.DOTNET_ROOT_X64 = dotnet;
  }
  const metadata = join(tmpdir(), `ezychat-azure-sign-${process.pid}.json`);
  writeFileSync(metadata, JSON.stringify(azureMetadata(settings), null, 2));
  result.AZURE_SIGN_METADATA = metadata;
  return result;
}

/** `KEY=value` lines for $GITHUB_ENV; refuses a value that would break the file's line format. Pure (tested). */
export function githubEnvLines(vars) {
  return Object.entries(vars)
    .map(([key, value]) => {
      if (/[\r\n]/.test(value)) throw new Error(`${key} contains a line break`);
      return `${key}=${value}\n`;
    })
    .join('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--github-env') || !process.env.GITHUB_ENV)
    throw new Error('usage (in GitHub Actions): node scripts/azure-sign.mjs --github-env');
  const vars = await azureSignEnv();
  if (!vars.WIN_SIGN_MODE) throw new Error('Azure signing is not configured for this run');
  appendFileSync(process.env.GITHUB_ENV, githubEnvLines(vars));
  console.log(`Azure signing ready: ${Object.keys(vars).join(', ')}`);
}
