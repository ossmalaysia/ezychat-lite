/**
 * Turns the Markdown that models tend to write into WhatsApp formatting, so customers never see stray
 * symbols. WhatsApp: *bold*, _italic_, ~strike~, ```mono```; no headings, tables or link syntax.
 * Text inside `code` or ```code``` is left as it is.
 */
export function toWhatsAppText(text: string): string {
  // Split out code so its content is never changed.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/);
  return parts
    .map((part, index) => (index % 2 === 1 ? part : convert(part)))
    .join('')
    .trim();
}

function convert(text: string): string {
  return (
    text
      // **bold** / __bold__ (Markdown) -> *bold* (WhatsApp). One line only, never empty.
      .replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, '*$1*')
      .replace(/__(?=\S)([^_\n]+?)__/g, '_$1_')
      // ~~strike~~ -> ~strike~
      .replace(/~~(?=\S)([^~\n]+?)~~/g, '~$1~')
      // # Heading -> Heading (WhatsApp has no headings).
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '$1')
      // [text](https://link) -> text (https://link); a link whose text is the address stays one address.
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
        label.trim() === url ? url : `${label.trim()} (${url})`,
      )
  );
}
