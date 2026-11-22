// Worker thread: reads one stored photo, shrinks it and encodes the chat preview. Runs apart from the
// server so a large or hostile photo never blocks WhatsApp, sockets or HTTP.
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import jpeg from 'jpeg-js';
import type { PreviewResult } from './image-preview.js';
import {
  PREVIEW_MAX_DECODE_MB,
  PREVIEW_MAX_MEGAPIXELS,
  PREVIEW_QUALITY,
  downscaleRgba,
  isJpeg,
  jpegOrientation,
} from './image-preview-scale.js';

const send = (result: PreviewResult) => parentPort!.postMessage(result);
const { path } = workerData as { path: string };
try {
  const file = readFileSync(path);
  if (!isJpeg(file)) send({ skip: 'not_jpeg' });
  // jpeg-js ignores EXIF: a phone photo stored sideways would show sideways. The chat shows the file
  // itself instead, which the browser turns upright.
  else if (jpegOrientation(file) !== 1) send({ skip: 'rotated' });
  else {
    const img = jpeg.decode(file, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: PREVIEW_MAX_MEGAPIXELS,
      maxMemoryUsageInMB: PREVIEW_MAX_DECODE_MB,
    });
    const small = downscaleRgba(img.data, img.width, img.height);
    send({ jpeg: jpeg.encode(small, PREVIEW_QUALITY).data });
  }
} catch {
  // Never echo decoder text: it may quote bytes of the file.
  send({ skip: 'unreadable' });
}
