import { afterEach, describe, expect, it, vi } from 'vitest';
import { canCopyImage, copyImageFromUrl, copyText, toPngBlob } from './clipboard';

function secure(value: boolean) {
  vi.stubGlobal('isSecureContext', value);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('clipboard', () => {
  it('copies text with the Clipboard API on a secure page', async () => {
    secure(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await copyText('*Hello* there');
    expect(writeText).toHaveBeenCalledWith('*Hello* there');
  });

  it('falls back to a selection copy on a LAN http page and keeps focus', async () => {
    secure(false);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    let copied = '';
    document.execCommand = vi.fn(() => {
      copied = document.querySelector('textarea')?.value ?? '';
      return true;
    });
    await copyText('Order #42');
    expect(copied).toBe('Order #42');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('reports a failed fallback copy', async () => {
    secure(false);
    document.execCommand = vi.fn(() => false);
    await expect(copyText('x')).rejects.toThrow('Clipboard unavailable');
  });

  it('offers image copy only where the browser can put images on the clipboard', () => {
    secure(false);
    expect(canCopyImage()).toBe(false);
    secure(true);
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write: vi.fn() } });
    expect(canCopyImage()).toBe(true);
  });

  it('copies a PNG image as is', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    expect(await toPngBlob(png)).toBe(png);
    const items: Record<string, Promise<Blob>>[] = [];
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(data: Record<string, Promise<Blob>>) {
          items.push(data);
        }
      },
    );
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => png }));
    await copyImageFromUrl('/api/media/1');
    expect(fetch).toHaveBeenCalledWith('/api/media/1', { credentials: 'same-origin' });
    expect(write).toHaveBeenCalledTimes(1);
    const blob = await items[0]!['image/png']!;
    expect(blob.type).toBe('image/png');
  });

  it('fails when the image cannot be downloaded', async () => {
    let item: Promise<Blob> | undefined;
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(data: Record<string, Promise<Blob>>) {
          item = data['image/png'];
        }
      },
    );
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { write: vi.fn(async () => void (await item)) },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(copyImageFromUrl('/api/media/x')).rejects.toThrow('Image download failed (404)');
  });

  it('redraws other image types as PNG', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4, height: 3, close }));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
      cb(new Blob(['out'], { type: 'image/png' }));
    });
    const out = await toPngBlob(new Blob(['jpg'], { type: 'image/jpeg' }));
    expect(out.type).toBe('image/png');
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('reports a failed conversion and still frees the bitmap', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(toPngBlob(new Blob(['w'], { type: 'image/webp' }))).rejects.toThrow(
      'Canvas unavailable',
    );
    expect(close).toHaveBeenCalled();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
      cb(null);
    });
    await expect(toPngBlob(new Blob(['w'], { type: 'image/webp' }))).rejects.toThrow(
      'Image conversion failed',
    );
  });
});
