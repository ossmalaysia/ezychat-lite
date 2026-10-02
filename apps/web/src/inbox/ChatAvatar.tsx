import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { initials } from '../lib/format';

/** Token-only fallback tints, picked by a stable seed so a contact keeps its colour. */
const TINTS = [
  'bg-accent text-accent-foreground',
  'bg-muted text-muted-foreground',
  'bg-note text-note-foreground',
  'bg-info/15 text-info',
  'bg-success/15 text-success',
  'bg-primary/15 text-primary',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const SIZES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
} as const;

export function ChatAvatar({
  name,
  src,
  seed,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  seed?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <Avatar className={cn(SIZES[size], className)} aria-hidden="true" title={name}>
      {src && <AvatarImage src={src} alt="" className="object-cover" />}
      <AvatarFallback className={cn('font-semibold', TINTS[hash(seed ?? name) % TINTS.length])}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
