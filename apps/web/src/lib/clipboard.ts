// Copying out of the app: message text and images to the system clipboard.

/**
 * Copies text. The async Clipboard API needs a secure context (localhost, the tunnel's https); a
 * LAN address over http falls back to the older selection copy, which still works there.
 */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  const active = document.activeElement as HTMLElement | null;
  try {
    area.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    area.remove();
    active?.focus?.();
  }
}

/** Images go on the clipboard only through the async API (secure context, ClipboardItem). */
export function canCopyImage(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  );
}

/** Browsers accept only PNG images on the clipboard: other types are redrawn as PNG. */
export async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Image conversion failed'))),
        'image/png',
      ),
    );
  } finally {
    bitmap.close();
  }
}

/** Copies the image at `url` (a same-origin media link). */
export async function copyImageFromUrl(url: string): Promise<void> {
  // The item takes a promise so the click's user activation still counts when the fetch ends.
  const png = fetch(url, { credentials: 'same-origin' }).then(async (res) => {
    if (!res.ok) throw new Error(`Image download failed (${res.status})`);
    return toPngBlob(await res.blob());
  });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
