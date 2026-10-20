import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { signCommand } = createRequire(import.meta.url)('./sign-windows.cjs');
const file = 'C:\\build\\release\\EzyChat Lite.exe';
const sha1 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

describe('Windows signing hook', () => {
  it('signs nothing while WIN_SIGN_MODE is not set (unsigned build, as today)', () => {
    expect(signCommand(file, {})).toBeNull();
  });

  it('signtool mode: certificate by thumbprint, SHA-256 and an RFC 3161 timestamp, no shell', () => {
    expect(signCommand(file, { WIN_SIGN_MODE: 'signtool', WIN_CERT_SHA1: sha1 })).toEqual({
      cmd: 'signtool.exe',
      args: [
        'sign',
        '/sha1',
        sha1,
        '/fd',
        'sha256',
        '/tr',
        'http://time.certum.pl',
        '/td',
        'sha256',
        file,
      ],
      shell: false,
    });
  });

  it('azure mode: signtool with the Azure dlib, its metadata and Microsoft timestamps, no shell', () => {
    expect(
      signCommand(file, {
        WIN_SIGN_MODE: 'azure',
        SIGNTOOL_PATH: 'C:\\sdk\\signtool.exe',
        AZURE_SIGN_DLIB: 'C:\\ast\\Azure.CodeSigning.Dlib.dll',
        AZURE_SIGN_METADATA: 'C:\\tmp\\metadata.json',
      }),
    ).toEqual({
      cmd: 'C:\\sdk\\signtool.exe',
      args: [
        'sign',
        '/v',
        '/fd',
        'SHA256',
        '/tr',
        'http://timestamp.acs.microsoft.com',
        '/td',
        'SHA256',
        '/dlib',
        'C:\\ast\\Azure.CodeSigning.Dlib.dll',
        '/dmdf',
        'C:\\tmp\\metadata.json',
        file,
      ],
      shell: false,
    });
  });

  it('command mode: puts the quoted file into the vendor command', () => {
    expect(
      signCommand(file, {
        WIN_SIGN_MODE: 'command',
        WIN_SIGN_COMMAND: 'CodeSignTool sign -input_file_path={file}',
      }),
    ).toEqual({ cmd: `CodeSignTool sign -input_file_path="${file}"`, args: [], shell: true });
  });

  it.each([
    ['a bad thumbprint', { WIN_SIGN_MODE: 'signtool', WIN_CERT_SHA1: 'abc' }, file, 'thumbprint'],
    [
      'a command without {file}',
      { WIN_SIGN_MODE: 'command', WIN_SIGN_COMMAND: 'sign' },
      file,
      '{file}',
    ],
    ['an unknown mode', { WIN_SIGN_MODE: 'magic' }, file, 'unknown WIN_SIGN_MODE'],
    [
      'azure without the dlib',
      { WIN_SIGN_MODE: 'azure', SIGNTOOL_PATH: 'x' },
      file,
      'AZURE_SIGN_DLIB',
    ],
    [
      'a file path with shell characters',
      { WIN_SIGN_MODE: 'command', WIN_SIGN_COMMAND: 'x {file}' },
      'a"b.exe',
      'unexpected',
    ],
  ])('refuses %s', (_label, env, path, message) => {
    expect(() => signCommand(path, env)).toThrow(message);
  });
});
