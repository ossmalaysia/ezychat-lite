import type { Message } from '@ezychat/shared';
import type { AiPromptImage, AiPromptPdf } from './provider-types.js';
import { AI_IMAGE_WAIT_MS, AI_LIVE_MEDIA_MS, AI_MAX_IMAGES, readPromptImage } from './images.js';

/**
 * The files of one batch the model is given (design docs/features/group-agents/design.md, Part C):
 * photos (JPEG/PNG/WebP) and PDFs the person sent. Owned by the files work; `service.ts` only calls
 * `collectPromptFiles`.
 */
export interface PromptFileDeps {
  /** Waits until a live download finishes (or the deadline / abort). */
  waitForMedia(messageId: string, signal: AbortSignal, deadline: number): Promise<void>;
  mediaPending(messageId: string): boolean;
  mediaPath(messageId: string): { path: string } | null;
  /** WhatsApp Safety level of a message; `high` files never reach the model. */
  safetyLevel(messageId: string): string | null;
}

export interface PromptFiles {
  images: AiPromptImage[];
  pdfs: AiPromptPdf[];
  /** Files of the batch the model was not given (type, size, pages or safety), for the prompt note. */
  skipped: Array<{ messageId: string; reason: 'type' | 'size' | 'pages' | 'safety' | 'unreadable' }>;
}

/** Interim: images only (the PDF part replaces this body). */
export async function collectPromptFiles(
  batch: readonly Message[],
  deps: PromptFileDeps,
  options: { maxImages?: number; signal: AbortSignal },
): Promise<PromptFiles> {
  const max = options.maxImages ?? AI_MAX_IMAGES;
  const images: AiPromptImage[] = [];
  const deadline = Date.now() + AI_IMAGE_WAIT_MS;
  for (const message of [...batch].reverse()) {
    if (images.length >= max || options.signal.aborted) break;
    if (message.fromMe || message.type !== 'image') continue;
    if (deps.mediaPending(message.id) && Date.now() - message.timestamp > AI_LIVE_MEDIA_MS) continue;
    await deps.waitForMedia(message.id, options.signal, deadline);
    const file = deps.mediaPath(message.id);
    const image = file ? readPromptImage(file.path) : null;
    if (image) images.push(image);
  }
  return { images: images.reverse(), pdfs: [], skipped: [] };
}
