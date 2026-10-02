import type { TypingEntry } from '../api/socket';

/** "Alice is typing…" for other agents working on the same chat. */
export function TypingIndicator({ entries, meId }: { entries: TypingEntry[]; meId: number | null }) {
  const others = entries.filter((e) => e.userId !== meId);
  if (others.length === 0) return null;
  const names = others.map((e) => e.displayName);
  const text =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : `${names.length} teammates are typing…`;
  return (
    <div
      className="flex items-center gap-2 px-4 py-1 text-xs text-neutral-500 dark:text-neutral-400"
      aria-live="polite"
    >
      <span className="flex gap-0.5" aria-hidden="true">
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current" />
      </span>
      <span className="truncate">{text}</span>
    </div>
  );
}
