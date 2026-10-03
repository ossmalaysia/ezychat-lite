import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyShareText,
  downloadShareCard,
  SHARE_APP_CAPTION,
  SHARE_APP_URL,
  shareApp,
  shareAppMessage,
  SOCIAL_SHARE_LINKS,
} from './share-app';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('public app sharing', () => {
  it('shares only the public repository URL, regardless of the inbox address', () => {
    expect(SHARE_APP_URL).toBe('https://github.com/ossmalaysia/ezychat-lite');
    expect(new URL(SOCIAL_SHARE_LINKS.linkedin).searchParams.get('url')).toBe(SHARE_APP_URL);
    expect(new URL(SOCIAL_SHARE_LINKS.facebook).searchParams.get('u')).toBe(SHARE_APP_URL);
    expect(shareAppMessage(SHARE_APP_CAPTION)).not.toContain(window.location.origin);
    expect(shareAppMessage('  A recommendation!  ')).toBe(`A recommendation!\n\n${SHARE_APP_URL}`);
  });

  it('opens native sharing with the edited caption and public link', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    expect(await shareApp('  Our team loves this.  ')).toBe('shared');
    expect(share).toHaveBeenCalledWith({
      title: 'EzyChat Lite',
      text: 'Our team loves this.',
      url: SHARE_APP_URL,
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('treats closing the native share sheet as cancellation without copying', async () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(new DOMException('User cancelled', 'AbortError')),
      clipboard: { writeText },
    });
    expect(await shareApp(SHARE_APP_CAPTION)).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'copies if native sharing is absent or fails (present=%s)',
    async (present) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', {
        share: present
          ? vi.fn().mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'))
          : undefined,
        clipboard: { writeText },
      });
      expect(await shareApp('Try this')).toBe('copied');
      expect(writeText).toHaveBeenCalledWith(`Try this\n\n${SHARE_APP_URL}`);
    },
  );

  it('propagates clipboard failures so the UI offers manual selection', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyShareText(SHARE_APP_URL)).rejects.toThrow('Clipboard unavailable');
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Blocked')) },
    });
    await expect(shareApp('Try this')).rejects.toThrow('Blocked');
  });

  it('downloads a locally generated PNG and releases its temporary URL', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        set src(value: string) {
          expect(value).toBe('/share-app.svg');
          this.onload?.();
        }
      },
    );
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      expect(type).toBe('image/png');
      callback(new Blob(['PNG fixture'], { type: 'image/png' }));
    });
    const create = vi.fn().mockReturnValue('blob:share-card');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('ezychat-lite.png');
      expect(this.href).toBe('blob:share-card');
    });
    await downloadShareCard();
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1080, 1080);
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:share-card');
  });

  it('reports a missing image instead of claiming a download', async () => {
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        set src(_value: string) {
          this.onerror?.();
        }
      },
    );
    await expect(downloadShareCard()).rejects.toThrow('Share image unavailable');
  });
});
