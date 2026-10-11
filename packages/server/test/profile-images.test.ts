import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { AppContext } from '../src/context.js';
import { createProfileImages } from '../src/http/profile-images.js';

const URL_OK = 'https://pps.whatsapp.net/v/photo.jpg';

function setup(getProfilePicture: (jid: string) => Promise<string | null>) {
  const ctx = { wa: { getProfilePicture: vi.fn(getProfilePicture) } } as unknown as AppContext;
  return { ctx, photo: createProfileImages(ctx, pino({ level: 'silent' })) };
}

describe('profile images', () => {
  it('remembers a photo, and "no photo", for the cache lifetime', async () => {
    const { ctx, photo } = setup(async (jid) => (jid === 'a' ? URL_OK : null));
    expect(await photo('a')).toBe(URL_OK);
    expect(await photo('b')).toBeNull();
    await photo('a');
    await photo('b');
    expect(ctx.wa.getProfilePicture).toHaveBeenCalledTimes(2);
  });

  it('never remembers a failed lookup as "no photo"', async () => {
    let fail = true;
    const { ctx, photo } = setup(async () => {
      if (fail) throw new Error('timed out');
      return URL_OK;
    });
    await expect(photo('a')).rejects.toThrow('timed out');
    fail = false;
    expect(await photo('a')).toBe(URL_OK);
    expect(ctx.wa.getProfilePicture).toHaveBeenCalledTimes(2);
  });
});
