import { ASK_EZY_PICTURE_BYTES, type AskEzyPicture } from '@ezychat/shared';
import { HttpError } from '../http/errors.js';
import { sniffImageMime } from '../ai/images.js';
import type { AiPromptImage } from '../ai/provider-types.js';

/**
 * The pictures of one Ask Ezy question, checked before any model call (design ask-ezy-image §4): each at most 5 MB
 * and a JPEG, PNG or WebP by its own bytes, never by a name or declared type. Kept in memory for this request only.
 */
export function readAskEzyPictures(pictures: readonly AskEzyPicture[]): AiPromptImage[] {
  return pictures.map(({ base64 }) => {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > ASK_EZY_PICTURE_BYTES)
      throw new HttpError(413, 'picture_too_large', 'A picture is larger than 5 MB');
    const mime = sniffImageMime(bytes);
    if (!mime) throw new HttpError(415, 'picture_type', 'Pictures must be JPEG, PNG or WebP');
    return { mime, base64 };
  });
}
