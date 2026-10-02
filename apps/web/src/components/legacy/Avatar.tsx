import clsx from 'clsx';
import { useState } from 'react';
import { initials } from '../../lib/format';

const palette = [
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const sizes = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
} as const;

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
  /** Stable seed for the background colour (defaults to name). */
  seed?: string;
}

export function Avatar({ name, src, size = 'md', className, seed }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const color = palette[hash(seed ?? name) % palette.length];
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
        sizes[size],
        color,
        className,
      )}
      aria-hidden="true"
      title={name}
    >
      {src && !broken ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
