import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ASK_EZY_MAX_PICTURES, ASK_EZY_PICTURE_BYTES } from '@ezychat/shared';

/**
 * Pictures attached to an Ask Ezy question (design docs/features/ask-ezy-image/design.md). They live only in the open
 * panel's memory (object URLs for the thumbnails, base64 for the request) and go to the server once, with their
 * question; later turns carry only a text note.
 */
export const MAX_PICTURES = ASK_EZY_MAX_PICTURES;
/** What is sent, after scaling: the server's limit. */
export const MAX_PICTURE_BYTES = ASK_EZY_PICTURE_BYTES;
/** A picked file larger than this is refused before it is read (keeps the phone's memory safe). */
export const MAX_PICKED_BYTES = 20 * 1024 * 1024;
/** Longest side after scaling: enough to read a chat screenshot, small enough to keep the cost low. */
export const MAX_SIDE = 2000;
export const PICTURE_ACCEPT = 'image/jpeg,image/png,image/webp';

export interface Picture {
  id: string;
  name: string;
  url: string;
  base64: string;
}

export type PictureProblem = 'type' | 'size' | 'count';

/** JPEG, PNG or WebP from the first bytes, never from the name (the server checks again). */
function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b))
    return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Scales a picture whose longest side is above MAX_SIDE; keeps PNG for screenshots, JPEG for photos. */
async function scaled(blob: Blob, mime: string): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return blob;
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return blob;
  const side = Math.max(bitmap.width, bitmap.height);
  if (side <= MAX_SIDE) return blob;
  const ratio = MAX_SIDE / side;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? blob), type, 0.85));
}

/** Reads picked, pasted or dropped files: refuses wrong types, files that are too large, and a 4th picture. */
export async function readPictures(
  files: File[],
  already: number,
): Promise<{ pictures: Picture[]; problem: PictureProblem | null }> {
  const pictures: Picture[] = [];
  let problem: PictureProblem | null = null;
  for (const file of files) {
    if (already + pictures.length >= MAX_PICTURES) {
      problem = 'count';
      break;
    }
    if (file.size > MAX_PICKED_BYTES) {
      problem = 'size';
      continue;
    }
    const head = await bytesOf(file.slice(0, 16));
    const mime = sniff(head);
    if (!mime) {
      problem = 'type';
      continue;
    }
    const blob = await scaled(file, mime);
    if (blob.size > MAX_PICTURE_BYTES) {
      problem = 'size';
      continue;
    }
    const base64 = toBase64(await bytesOf(blob));
    pictures.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name || 'picture',
      url:
        typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(blob)
          : `data:${blob.type || mime};base64,${base64}`,
      base64,
    });
  }
  return { pictures, problem };
}

/** Frees the memory of thumbnails that are no longer shown. */
export function releasePictures(pictures: readonly Picture[]) {
  if (typeof URL.revokeObjectURL !== 'function') return;
  for (const p of pictures) if (p.url.startsWith('blob:')) URL.revokeObjectURL(p.url);
}

/** Thumbnails above the question box, each with a remove button (44 px touch area on phones). */
export function PictureTray({
  pictures,
  problem,
  onRemove,
}: {
  pictures: Picture[];
  problem: PictureProblem | null;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation('inbox');
  if (!pictures.length && !problem) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="ask-ezy-pictures">
      {pictures.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label={t('askEzy.pictures.tray')}>
          {pictures.map((p, i) => (
            <li key={p.id} className="relative">
              <img
                src={p.url}
                alt={t('askEzy.pictures.alt', { n: i + 1 })}
                className="size-14 rounded-md border border-border bg-muted object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute -top-1.5 -right-1.5 size-6 rounded-full border border-border shadow-sm after:absolute after:-inset-2.5"
                onClick={() => onRemove(p.id)}
                aria-label={t('askEzy.pictures.remove', { n: i + 1 })}
              >
                <X className="size-3" aria-hidden />
              </Button>
            </li>
          ))}
          <li className="text-xs text-muted-foreground">
            {t('askEzy.pictures.count', { count: pictures.length, max: MAX_PICTURES })}
          </li>
        </ul>
      )}
      {problem && (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-xs text-danger"
          data-testid="ask-ezy-picture-error"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {t(`askEzy.pictures.problem.${problem}`, { max: MAX_PICTURES })}
        </p>
      )}
    </div>
  );
}

/** The pictures of a sent question, inside its bubble; a tap opens one large. */
export function QuestionPictures({ pictures }: { pictures: Picture[] }) {
  const { t } = useTranslation('inbox');
  const [open, setOpen] = useState<Picture | null>(null);
  return (
    <>
      <ul
        className="flex flex-wrap justify-end gap-1.5 self-end"
        data-testid="ask-ezy-question-pictures"
      >
        {pictures.map((p, i) => (
          <li key={p.id}>
            <Button
              type="button"
              variant="ghost"
              className="h-auto rounded-md p-0"
              onClick={() => setOpen(p)}
              aria-label={t('askEzy.pictures.open', { n: i + 1 })}
            >
              <img
                src={p.url}
                alt=""
                className="size-20 rounded-md border border-border bg-muted object-cover"
              />
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-h-[90dvh] max-w-[min(90vw,900px)] p-3">
          <DialogTitle className="sr-only">{t('askEzy.pictures.viewer')}</DialogTitle>
          {open && (
            <img src={open.url} alt="" className="max-h-[80dvh] w-full rounded-md object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
