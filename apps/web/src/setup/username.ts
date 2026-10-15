/** The username offered when "Your name" gives too few usable characters (e.g. a name in Chinese). */
export const USERNAME_FALLBACK = 'admin';

/** "Aisyah Rahman" → "aisyah.rahman"; characters a username cannot hold are dropped (may be short). */
export function usernameFromName(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9_.-]/g, '')
      .replace(/\.{2,}/g, '.')
      // Cut first, so the cut can never leave a dot (or dash) at the end.
      .slice(0, 32)
      .replace(/^[._-]+|[._-]+$/g, '')
  );
}

/**
 * The username prefilled from "Your name": always a valid username once a name is typed, so the
 * owner never has to type one. Falls back to "admin" when the name gives fewer than 3 characters.
 */
export function usernameFrom(name: string): string {
  if (!name.trim()) return '';
  const fromName = usernameFromName(name);
  return fromName.length >= 3 ? fromName : USERNAME_FALLBACK;
}
