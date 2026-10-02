import { describe, expect, it } from 'vitest';
import { createBaileysAdapter } from '../index.js';
import { WaUnavailableError } from '../types.js';

describe('createBaileysAdapter (offline smoke)', () => {
  it('starts disconnected and refuses to send without connecting', async () => {
    const a = createBaileysAdapter({ authDir: 'unused-auth-dir', historyDays: 7 });
    expect(a.status.state).toBe('disconnected');
    await expect(a.sendText('1@s.whatsapp.net', 'hi')).rejects.toBeInstanceOf(WaUnavailableError);
    expect(await a.downloadMedia('nope')).toBeNull();
    expect(await a.getProfilePicture('1@s.whatsapp.net')).toBeNull();
    await a.disconnect();
    expect(a.status.state).toBe('disconnected');
  });
});
