import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('modal backdrops', () => {
  // Tailwind's `bg-black/50` compiles to oklab(0 0 0 / 0.5), which current Chrome paints as
  // fully transparent: desktop dialogs then open without dimming the page.
  it.each(['dialog.tsx', 'alert-dialog.tsx', 'sheet.tsx', 'drawer.tsx'])(
    '%s dims the page with the rgb overlay token',
    (file) => {
      const source = ui(file);
      expect(source).toContain('bg-overlay');
      expect(source).not.toMatch(/bg-black\//);
    },
  );

  it('defines the overlay token in rgb, not a color-mix of black', () => {
    const css = readFileSync(join(__dirname, '../../index.css'), 'utf8');
    expect(css).toMatch(/--overlay:\s*rgb\(0 0 0 \/ 0\.5\);/);
    expect(css).toMatch(/--color-overlay:\s*var\(--overlay\);/);
  });
});
