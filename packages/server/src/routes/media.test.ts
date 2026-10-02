import { describe, expect, it } from 'vitest';
import { contentDisposition } from './media.js';

describe('contentDisposition', () => {
  it('renders passive raster/AV types inline', () => {
    expect(contentDisposition('image/jpeg', null, 'id1')).toBe('inline');
    expect(contentDisposition('video/mp4', null, 'id1')).toBe('inline');
    expect(contentDisposition('audio/ogg; codecs=opus', null, 'id1')).toBe('inline');
  });

  it('forces scriptable types to download', () => {
    for (const mime of ['image/svg+xml', 'text/html', 'application/xhtml+xml', 'application/pdf']) {
      expect(contentDisposition(mime, 'evil.svg', 'id1')).toMatch(/^attachment;/);
    }
  });
});
