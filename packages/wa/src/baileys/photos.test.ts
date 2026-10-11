import { describe, expect, it } from 'vitest';
import { profilePhoto } from './photos.js';

const waError = (code: number) => Object.assign(new Error('item-not-found'), { data: code });

describe('profilePhoto', () => {
  it('returns the URL, or null when there is no photo or it is private', async () => {
    expect(await profilePhoto(async () => 'https://pps.whatsapp.net/p.jpg')).toBe(
      'https://pps.whatsapp.net/p.jpg',
    );
    expect(await profilePhoto(() => Promise.reject(waError(404)))).toBeNull();
    expect(await profilePhoto(() => Promise.reject(waError(401)))).toBeNull();
  });

  it('treats other errors and a timed-out (undefined) result as failures', async () => {
    await expect(profilePhoto(() => Promise.reject(waError(500)))).rejects.toThrow();
    await expect(profilePhoto(async () => undefined)).rejects.toThrow('no result');
  });
});
