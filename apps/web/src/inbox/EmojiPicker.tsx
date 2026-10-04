import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchField } from '@/components/app/SearchField';

const CATEGORIES = ['All', 'Faces', 'Gestures', 'Hearts', 'Work'] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_KEYS = {
  All: 'emoji.category.all',
  Faces: 'emoji.category.faces',
  Gestures: 'emoji.category.gestures',
  Hearts: 'emoji.category.hearts',
  Work: 'emoji.category.work',
} as const satisfies Record<Category, string>;
/** `name` and `keywords` stay English so English search terms work in every language. */
const EMOJI = [
  {
    symbol: '😀',
    name: 'Grinning face',
    nameKey: 'emoji.names.grinningFace',
    category: 'Faces',
    keywords: 'happy smile',
  },
  {
    symbol: '😊',
    name: 'Smiling face',
    nameKey: 'emoji.names.smilingFace',
    category: 'Faces',
    keywords: 'happy thank you',
  },
  {
    symbol: '😂',
    name: 'Tears of joy',
    nameKey: 'emoji.names.tearsOfJoy',
    category: 'Faces',
    keywords: 'laugh funny',
  },
  {
    symbol: '🤣',
    name: 'Rolling on the floor laughing',
    nameKey: 'emoji.names.rollingOnTheFloorLaughing',
    category: 'Faces',
    keywords: 'funny lol',
  },
  { symbol: '😉', name: 'Winking face', nameKey: 'emoji.names.winkingFace', category: 'Faces' },
  {
    symbol: '😍',
    name: 'Heart eyes',
    nameKey: 'emoji.names.heartEyes',
    category: 'Faces',
    keywords: 'love',
  },
  {
    symbol: '🥰',
    name: 'Smiling face with hearts',
    nameKey: 'emoji.names.smilingFaceWithHearts',
    category: 'Faces',
    keywords: 'love',
  },
  {
    symbol: '😎',
    name: 'Sunglasses face',
    nameKey: 'emoji.names.sunglassesFace',
    category: 'Faces',
    keywords: 'cool',
  },
  {
    symbol: '🤔',
    name: 'Thinking face',
    nameKey: 'emoji.names.thinkingFace',
    category: 'Faces',
    keywords: 'question',
  },
  {
    symbol: '😅',
    name: 'Smiling face with sweat',
    nameKey: 'emoji.names.smilingFaceWithSweat',
    category: 'Faces',
    keywords: 'relief',
  },
  {
    symbol: '😔',
    name: 'Pensive face',
    nameKey: 'emoji.names.pensiveFace',
    category: 'Faces',
    keywords: 'sad sorry',
  },
  {
    symbol: '😢',
    name: 'Crying face',
    nameKey: 'emoji.names.cryingFace',
    category: 'Faces',
    keywords: 'sad sorry',
  },
  {
    symbol: '😭',
    name: 'Loudly crying face',
    nameKey: 'emoji.names.loudlyCryingFace',
    category: 'Faces',
    keywords: 'sad',
  },
  {
    symbol: '😮',
    name: 'Surprised face',
    nameKey: 'emoji.names.surprisedFace',
    category: 'Faces',
    keywords: 'wow',
  },
  {
    symbol: '🙃',
    name: 'Upside down face',
    nameKey: 'emoji.names.upsideDownFace',
    category: 'Faces',
  },
  {
    symbol: '🤗',
    name: 'Hugging face',
    nameKey: 'emoji.names.huggingFace',
    category: 'Faces',
    keywords: 'hug',
  },
  {
    symbol: '👍',
    name: 'Thumbs up',
    nameKey: 'emoji.names.thumbsUp',
    category: 'Gestures',
    keywords: 'yes good approve okay',
  },
  {
    symbol: '👎',
    name: 'Thumbs down',
    nameKey: 'emoji.names.thumbsDown',
    category: 'Gestures',
    keywords: 'no',
  },
  {
    symbol: '👋',
    name: 'Waving hand',
    nameKey: 'emoji.names.wavingHand',
    category: 'Gestures',
    keywords: 'hello bye',
  },
  {
    symbol: '🙏',
    name: 'Folded hands',
    nameKey: 'emoji.names.foldedHands',
    category: 'Gestures',
    keywords: 'thanks thank you please pray',
  },
  {
    symbol: '👌',
    name: 'OK hand',
    nameKey: 'emoji.names.okHand',
    category: 'Gestures',
    keywords: 'okay',
  },
  {
    symbol: '👏',
    name: 'Clapping hands',
    nameKey: 'emoji.names.clappingHands',
    category: 'Gestures',
    keywords: 'well done congratulations',
  },
  {
    symbol: '🙌',
    name: 'Raised hands',
    nameKey: 'emoji.names.raisedHands',
    category: 'Gestures',
    keywords: 'celebrate',
  },
  {
    symbol: '🤝',
    name: 'Handshake',
    nameKey: 'emoji.names.handshake',
    category: 'Gestures',
    keywords: 'agreement deal',
  },
  {
    symbol: '💪',
    name: 'Flexed biceps',
    nameKey: 'emoji.names.flexedBiceps',
    category: 'Gestures',
    keywords: 'strong',
  },
  {
    symbol: '✌️',
    name: 'Victory hand',
    nameKey: 'emoji.names.victoryHand',
    category: 'Gestures',
    keywords: 'peace',
  },
  {
    symbol: '❤️',
    name: 'Red heart',
    nameKey: 'emoji.names.redHeart',
    category: 'Hearts',
    keywords: 'love',
  },
  {
    symbol: '🧡',
    name: 'Orange heart',
    nameKey: 'emoji.names.orangeHeart',
    category: 'Hearts',
    keywords: 'love',
  },
  {
    symbol: '💛',
    name: 'Yellow heart',
    nameKey: 'emoji.names.yellowHeart',
    category: 'Hearts',
    keywords: 'love',
  },
  {
    symbol: '💚',
    name: 'Green heart',
    nameKey: 'emoji.names.greenHeart',
    category: 'Hearts',
    keywords: 'love',
  },
  {
    symbol: '💙',
    name: 'Blue heart',
    nameKey: 'emoji.names.blueHeart',
    category: 'Hearts',
    keywords: 'love',
  },
  {
    symbol: '💜',
    name: 'Purple heart',
    nameKey: 'emoji.names.purpleHeart',
    category: 'Hearts',
    keywords: 'love',
  },
  {
    symbol: '🤍',
    name: 'White heart',
    nameKey: 'emoji.names.whiteHeart',
    category: 'Hearts',
    keywords: 'love',
  },
  {
    symbol: '💕',
    name: 'Two hearts',
    nameKey: 'emoji.names.twoHearts',
    category: 'Hearts',
    keywords: 'love',
  },
  {
    symbol: '✅',
    name: 'Check mark',
    nameKey: 'emoji.names.checkMark',
    category: 'Work',
    keywords: 'done yes confirmed complete',
  },
  {
    symbol: '❌',
    name: 'Cross mark',
    nameKey: 'emoji.names.crossMark',
    category: 'Work',
    keywords: 'no cancel',
  },
  {
    symbol: '❓',
    name: 'Question mark',
    nameKey: 'emoji.names.questionMark',
    category: 'Work',
    keywords: 'help',
  },
  {
    symbol: '⚠️',
    name: 'Warning',
    nameKey: 'emoji.names.warning',
    category: 'Work',
    keywords: 'attention',
  },
  {
    symbol: '📌',
    name: 'Pushpin',
    nameKey: 'emoji.names.pushpin',
    category: 'Work',
    keywords: 'important',
  },
  {
    symbol: '📦',
    name: 'Package',
    nameKey: 'emoji.names.package',
    category: 'Work',
    keywords: 'delivery order shipping',
  },
  {
    symbol: '🚚',
    name: 'Delivery truck',
    nameKey: 'emoji.names.deliveryTruck',
    category: 'Work',
    keywords: 'shipping',
  },
  {
    symbol: '📍',
    name: 'Location pin',
    nameKey: 'emoji.names.locationPin',
    category: 'Work',
    keywords: 'address place',
  },
  {
    symbol: '📅',
    name: 'Calendar',
    nameKey: 'emoji.names.calendar',
    category: 'Work',
    keywords: 'date appointment',
  },
  {
    symbol: '⏰',
    name: 'Alarm clock',
    nameKey: 'emoji.names.alarmClock',
    category: 'Work',
    keywords: 'time reminder',
  },
  {
    symbol: '📞',
    name: 'Telephone',
    nameKey: 'emoji.names.telephone',
    category: 'Work',
    keywords: 'call phone',
  },
  {
    symbol: '💬',
    name: 'Speech balloon',
    nameKey: 'emoji.names.speechBalloon',
    category: 'Work',
    keywords: 'chat message',
  },
  {
    symbol: '💰',
    name: 'Money bag',
    nameKey: 'emoji.names.moneyBag',
    category: 'Work',
    keywords: 'payment price',
  },
  {
    symbol: '🎉',
    name: 'Party popper',
    nameKey: 'emoji.names.partyPopper',
    category: 'Work',
    keywords: 'congratulations celebrate',
  },
  {
    symbol: '🎂',
    name: 'Birthday cake',
    nameKey: 'emoji.names.birthdayCake',
    category: 'Work',
    keywords: 'birthday',
  },
  {
    symbol: '🎁',
    name: 'Gift',
    nameKey: 'emoji.names.gift',
    category: 'Work',
    keywords: 'present',
  },
  {
    symbol: '🌟',
    name: 'Glowing star',
    nameKey: 'emoji.names.glowingStar',
    category: 'Work',
    keywords: 'great excellent',
  },
  { symbol: '🔥', name: 'Fire', nameKey: 'emoji.names.fire', category: 'Work', keywords: 'hot' },
] as const satisfies readonly {
  symbol: string;
  name: string;
  nameKey: `emoji.names.${string}`;
  category: Category;
  keywords?: string;
}[];

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
  const { t } = useTranslation('inbox');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const picked = useRef(false);
  const titleId = useId();
  const normalized = query.trim().toLowerCase();
  const matches = EMOJI.filter((emoji) =>
    normalized
      ? `${emoji.symbol} ${emoji.name} ${t(emoji.nameKey)} ${'keywords' in emoji ? emoji.keywords : ''}`
          .toLowerCase()
          .includes(normalized)
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
          aria-label={t('emoji.insert')}
          title={t('emoji.insert')}
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
          {t('emoji.title')}
        </h2>
        <SearchField
          value={query}
          onChange={setQuery}
          label={t('emoji.search')}
          placeholder={t('emoji.searchPlaceholder')}
        />
        <div
          className="flex shrink-0 flex-wrap gap-1"
          role="group"
          aria-label={t('emoji.categories')}
        >
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
              {t(CATEGORY_KEYS[item])}
            </Button>
          ))}
        </div>
        <div
          role="group"
          aria-label={t('emoji.choices')}
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
              aria-label={t(emoji.nameKey)}
              title={t(emoji.nameKey)}
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
            {t('emoji.empty')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
