import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SIDE, readPictures, releasePictures } from './AskEzyPictures';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [...'RIFF']
  .map((c) => c.charCodeAt(0))
  .concat(
    [0, 0, 0, 0],
    [...'WEBP'].map((c) => c.charCodeAt(0)),
  );
const file = (bytes: number[], name = 'p') => new File([new Uint8Array([...bytes, 9, 9])], name);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readPictures', () => {
  it('reads JPEG, PNG and WebP from their bytes, whatever the name says', async () => {
    const { pictures, problem } = await readPictures([file(JPEG, 'a.txt'), file(WEBP, 'b')], 0);
    expect(problem).toBeNull();
    expect(pictures.map((p) => atob(p.base64).charCodeAt(0))).toEqual([0xff, 0x52]);
    expect((await readPictures([file(PNG, 'c.png')], 0)).pictures[0]!.name).toBe('c.png');
    expect((await readPictures([file([0x25, 0x50, 0x44, 0x46], 'd.png')], 0)).problem).toBe('type');
  });

  it('stops at 2 pictures and keeps the ones before', async () => {
    const r = await readPictures([file(PNG), file(PNG)], 1);
    expect(r.pictures).toHaveLength(1);
    expect(r.problem).toBe('count');
  });

  it('scales a picture above 2000 px and refuses one still above 5 MB', async () => {
    const draw = vi.fn();
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4000, height: 1000 }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: draw,
    } as never);
    let size = 10;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      done: BlobCallback,
      type?: string,
    ) {
      expect([this.width, this.height, type]).toEqual([MAX_SIDE, 500, 'image/jpeg']);
      done(new Blob([new Uint8Array([...JPEG, ...new Array(size).fill(0)])], { type }));
    });
    const scaled = await readPictures([file(JPEG)], 0);
    expect(draw).toHaveBeenCalled();
    expect(scaled.pictures).toHaveLength(1);
    size = 5 * 1024 * 1024;
    expect((await readPictures([file(JPEG)], 0)).problem).toBe('size');
  });

  it('keeps a small picture as it is, also when the browser cannot decode it', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 600 }));
    expect((await readPictures([file(PNG)], 0)).pictures).toHaveLength(1);
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('bad');
    });
    expect((await readPictures([file(PNG)], 0)).pictures).toHaveLength(1);
  });

  it('releases the object URLs it made', async () => {
    const revoke = vi.fn();
    const url = URL as unknown as Record<string, unknown>;
    const saved = { create: url.createObjectURL, revoke: url.revokeObjectURL };
    url.createObjectURL = () => 'blob:x';
    url.revokeObjectURL = revoke;
    try {
      const { pictures } = await readPictures([file(PNG)], 0);
      expect(pictures[0]!.url).toBe('blob:x');
      releasePictures([...pictures, { id: 'd', name: 'd', url: 'data:x', base64: '' }]);
      expect(revoke).toHaveBeenCalledTimes(1);
    } finally {
      url.createObjectURL = saved.create;
      url.revokeObjectURL = saved.revoke;
    }
  });
});
