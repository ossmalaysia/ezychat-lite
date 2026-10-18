import { GITHUB_REPO_URL } from './links';

/** Only this public project URL is shared, never the private inbox address. */
export const SHARE_APP_URL = GITHUB_REPO_URL;
export const SHARE_APP_CAPTION =
  "I'm using EzyChat Lite — a free WhatsApp team inbox that runs on my own computer. One number, a shared inbox for my team, and I own my data.";

/** Social share pages for a link (another product shares its own website). */
export function socialShareLinks(url: string): { linkedin: string; facebook: string } {
  return {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url })}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url })}`,
  };
}

export const SOCIAL_SHARE_LINKS = socialShareLinks(SHARE_APP_URL);

export function shareAppMessage(caption: string, url: string = SHARE_APP_URL): string {
  return [caption.trim(), url].filter(Boolean).join('\n\n');
}

export async function copyShareText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(text);
}

/** Native share failures fall back to copying. Closing the share sheet is quiet. */
export async function shareApp(
  caption: string,
  url: string = SHARE_APP_URL,
): Promise<'shared' | 'cancelled' | 'copied'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'EzyChat Lite', text: caption.trim(), url });
      return 'shared';
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError'
      ) {
        return 'cancelled';
      }
    }
  }
  await copyShareText(shareAppMessage(caption, url));
  return 'copied';
}

/** Rasterize the static brand card locally; no inbox content enters the image. */
export async function downloadShareCard(): Promise<void> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Share image unavailable'));
    image.src = '/share-app.svg';
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Share image unavailable');
  context.drawImage(image, 0, 0, 1080, 1080);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Share image unavailable'));
    }, 'image/png');
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ezychat-lite.png';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
