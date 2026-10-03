import { useId, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchField } from '@/components/app/SearchField';

const CATEGORIES = ['All', 'Faces', 'Gestures', 'Hearts', 'Work'] as const;
type Category = (typeof CATEGORIES)[number];
const EMOJI: { symbol: string; name: string; category: Category; keywords?: string }[] = [
  { symbol: '😀', name: 'Grinning face', category: 'Faces', keywords: 'happy smile' },
  { symbol: '😊', name: 'Smiling face', category: 'Faces', keywords: 'happy thank you' },
  { symbol: '😂', name: 'Tears of joy', category: 'Faces', keywords: 'laugh funny' },
  { symbol: '🤣', name: 'Rolling on the floor laughing', category: 'Faces', keywords: 'funny lol' },
  { symbol: '😉', name: 'Winking face', category: 'Faces' },
  { symbol: '😍', name: 'Heart eyes', category: 'Faces', keywords: 'love' },
  { symbol: '🥰', name: 'Smiling face with hearts', category: 'Faces', keywords: 'love' },
  { symbol: '😎', name: 'Sunglasses face', category: 'Faces', keywords: 'cool' },
  { symbol: '🤔', name: 'Thinking face', category: 'Faces', keywords: 'question' },
  { symbol: '😅', name: 'Smiling face with sweat', category: 'Faces', keywords: 'relief' },
  { symbol: '😔', name: 'Pensive face', category: 'Faces', keywords: 'sad sorry' },
  { symbol: '😢', name: 'Crying face', category: 'Faces', keywords: 'sad sorry' },
  { symbol: '😭', name: 'Loudly crying face', category: 'Faces', keywords: 'sad' },
  { symbol: '😮', name: 'Surprised face', category: 'Faces', keywords: 'wow' },
  { symbol: '🙃', name: 'Upside down face', category: 'Faces' },
  { symbol: '🤗', name: 'Hugging face', category: 'Faces', keywords: 'hug' },
  { symbol: '👍', name: 'Thumbs up', category: 'Gestures', keywords: 'yes good approve okay' },
  { symbol: '👎', name: 'Thumbs down', category: 'Gestures', keywords: 'no' },
  { symbol: '👋', name: 'Waving hand', category: 'Gestures', keywords: 'hello bye' },
  {
    symbol: '🙏',
    name: 'Folded hands',
    category: 'Gestures',
    keywords: 'thanks thank you please pray',
  },
  { symbol: '👌', name: 'OK hand', category: 'Gestures', keywords: 'okay' },
  {
    symbol: '👏',
    name: 'Clapping hands',
    category: 'Gestures',
    keywords: 'well done congratulations',
  },
  { symbol: '🙌', name: 'Raised hands', category: 'Gestures', keywords: 'celebrate' },
  { symbol: '🤝', name: 'Handshake', category: 'Gestures', keywords: 'agreement deal' },
  { symbol: '💪', name: 'Flexed biceps', category: 'Gestures', keywords: 'strong' },
  { symbol: '✌️', name: 'Victory hand', category: 'Gestures', keywords: 'peace' },
  { symbol: '❤️', name: 'Red heart', category: 'Hearts', keywords: 'love' },
  { symbol: '🧡', name: 'Orange heart', category: 'Hearts', keywords: 'love' },
  { symbol: '💛', name: 'Yellow heart', category: 'Hearts', keywords: 'love' },
  { symbol: '💚', name: 'Green heart', category: 'Hearts', keywords: 'love' },
  { symbol: '💙', name: 'Blue heart', category: 'Hearts', keywords: 'love' },
  { symbol: '💜', name: 'Purple heart', category: 'Hearts', keywords: 'love' },
  { symbol: '🤍', name: 'White heart', category: 'Hearts', keywords: 'love' },
  { symbol: '💕', name: 'Two hearts', category: 'Hearts', keywords: 'love' },
  { symbol: '✅', name: 'Check mark', category: 'Work', keywords: 'done yes confirmed complete' },
  { symbol: '❌', name: 'Cross mark', category: 'Work', keywords: 'no cancel' },
  { symbol: '❓', name: 'Question mark', category: 'Work', keywords: 'help' },
  { symbol: '⚠️', name: 'Warning', category: 'Work', keywords: 'attention' },
  { symbol: '📌', name: 'Pushpin', category: 'Work', keywords: 'important' },
  { symbol: '📦', name: 'Package', category: 'Work', keywords: 'delivery order shipping' },
  { symbol: '🚚', name: 'Delivery truck', category: 'Work', keywords: 'shipping' },
  { symbol: '📍', name: 'Location pin', category: 'Work', keywords: 'address place' },
  { symbol: '📅', name: 'Calendar', category: 'Work', keywords: 'date appointment' },
  { symbol: '⏰', name: 'Alarm clock', category: 'Work', keywords: 'time reminder' },
  { symbol: '📞', name: 'Telephone', category: 'Work', keywords: 'call phone' },
  { symbol: '💬', name: 'Speech balloon', category: 'Work', keywords: 'chat message' },
  { symbol: '💰', name: 'Money bag', category: 'Work', keywords: 'payment price' },
  { symbol: '🎉', name: 'Party popper', category: 'Work', keywords: 'congratulations celebrate' },
  { symbol: '🎂', name: 'Birthday cake', category: 'Work', keywords: 'birthday' },
  { symbol: '🎁', name: 'Gift', category: 'Work', keywords: 'present' },
  { symbol: '🌟', name: 'Glowing star', category: 'Work', keywords: 'great excellent' },
  { symbol: '🔥', name: 'Fire', category: 'Work', keywords: 'hot' },
];

/** Small, local-only emoji picker. Search never leaves the device. */
export function EmojiPicker({
  disabled,
  onOpen,
  onPick,
}: {
  disabled?: boolean;
  onOpen(): void;
  onPick(emoji: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const picked = useRef(false);
  const titleId = useId();
  const normalized = query.trim().toLowerCase();
  const matches = EMOJI.filter((emoji) =>
    normalized
      ? `${emoji.symbol} ${emoji.name} ${emoji.keywords ?? ''}`.toLowerCase().includes(normalized)
      : category === 'All' || category === emoji.category,
  );

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (value) {
          picked.current = false;
          setQuery('');
          setCategory('All');
          onOpen();
        }
        setOpen(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-touch"
          disabled={disabled}
          aria-label="Insert emoji"
          title="Insert emoji"
          className="rounded-full text-muted-foreground"
        >
          <Smile className="size-5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        aria-labelledby={titleId}
        onCloseAutoFocus={(e) => {
          // Composer restores the caret after insertion. Do not steal it back.
          if (picked.current) e.preventDefault();
        }}
        className="flex max-h-[min(26rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-hidden p-3"
      >
        <h2 id={titleId} className="text-sm font-semibold">
          Emoji
        </h2>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search emoji"
          placeholder="Search emoji…"
        />
        <div className="flex shrink-0 flex-wrap gap-1" role="group" aria-label="Emoji categories">
          {CATEGORIES.map((item) => (
            <Button
              key={item}
              variant={category === item && !normalized ? 'secondary' : 'ghost'}
              size="sm"
              className="min-h-11 px-2"
              aria-pressed={category === item && !normalized}
              onClick={() => {
                setCategory(item);
                setQuery('');
              }}
            >
              {item}
            </Button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Emoji choices"
          className="emoji-scroll grid min-h-0 grid-cols-6 gap-1 overflow-y-auto overscroll-contain"
          onKeyDown={(e) => {
            const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 }[e.key];
            if (offset == null) return;
            const buttons = Array.from(e.currentTarget.querySelectorAll('button'));
            const index = buttons.indexOf(e.target as HTMLButtonElement);
            if (index < 0) return;
            e.preventDefault();
            buttons[Math.max(0, Math.min(buttons.length - 1, index + offset))]?.focus();
          }}
        >
          {matches.map((emoji) => (
            <Button
              key={emoji.symbol}
              variant="ghost"
              size="icon-touch"
              className="w-full text-2xl"
              aria-label={emoji.name}
              title={emoji.name}
              onClick={() => {
                picked.current = true;
                onPick(emoji.symbol);
                setOpen(false);
              }}
            >
              <span aria-hidden="true">{emoji.symbol}</span>
            </Button>
          ))}
        </div>
        {matches.length === 0 && (
          <p role="status" className="py-3 text-sm text-muted-foreground">
            No emoji found. Try “smile”, “thanks” or “delivery”.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
