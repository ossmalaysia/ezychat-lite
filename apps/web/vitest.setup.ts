// Tests render in English (the source catalogs), matching the text most tests query for.
import { afterEach } from 'vitest';
import { initI18n } from './src/i18n';

await initI18n();

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
