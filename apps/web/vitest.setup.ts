// Tests render in English (the source catalogs), matching the text most tests query for.
import { afterEach } from 'vitest';
import { initI18n } from './src/i18n';

await initI18n();

// jsdom runs no CSS animations, so `animationend` never fires. Since jsdom 31 its computed style
// applies stylesheet rules such as vaul's closing `animation-name` (slideToBottom), and Radix
// Presence then waits forever for that event: closed drawers and dialogs never unmount. Turn
// animations off, as a browser with no animation engine would report them.
const noAnimations = document.createElement('style');
noAnimations.textContent = '*, *::before, *::after { animation-name: none !important; }';
document.head.appendChild(noAnimations);

// React reports invalid HTML nesting (a form inside a form, a button inside a button) only as a
// console error; the browser then breaks the markup. Every test fails on one.
const nestingErrors: string[] = [];
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [format, ...rest] = args;
  let i = 0;
  const text = String(format).replace(/%s/g, () => String(rest[i++]));
  if (/cannot be a descendant of|cannot contain a nested|cannot be a child of/.test(text)) {
    nestingErrors.push(text.split('\n')[0] ?? text);
  }
  consoleError(...args);
};
afterEach(() => {
  const found = nestingErrors.splice(0);
  if (found.length > 0) throw new Error(`Invalid HTML nesting: ${found.join(' | ')}`);
});
