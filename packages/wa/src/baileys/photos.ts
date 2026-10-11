/**
 * Turns a Baileys `profilePictureUrl` call into an answer: a URL, `null` for a real "no photo"
 * (WhatsApp error 404) or "private" (401), or a thrown error for a failed lookup, so it is never
 * remembered as "no photo". Baileys resolves a timed-out query to `undefined`: that is a failure too.
 */
export async function profilePhoto(
  lookup: () => Promise<string | undefined>,
): Promise<string | null> {
  let url: string | undefined;
  try {
    url = await lookup();
  } catch (err) {
    const code = (err as { data?: unknown }).data;
    if (code === 404 || code === 401) return null;
    throw err;
  }
  if (!url) throw new Error('Profile picture query returned no result');
  return url;
}
