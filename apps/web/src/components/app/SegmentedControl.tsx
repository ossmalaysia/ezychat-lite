import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
}

/**
 * One row of joined options (a compact radio group). Keyboard and screen-reader behaviour comes
 * from the RadioGroup primitive: arrow keys move the selection, the group is named by
 * `aria-labelledby`.
 */
export function SegmentedControl<V extends string>({
  value,
  onValueChange,
  options,
  className,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: {
  value: V;
  onValueChange: (value: V) => void;
  options: readonly SegmentedOption<V>[];
  className?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const base = labelledBy ?? 'segmented';
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      value={value}
      onValueChange={(v) => onValueChange(v as V)}
      className={cn(
        'inline-flex w-fit gap-0 overflow-hidden rounded-md border border-input',
        className,
      )}
    >
      {options.map((option) => (
        <Label
          key={option.value}
          htmlFor={`${base}-${option.value}`}
          className={cn(
            'inline-flex h-9 cursor-pointer items-center justify-center px-4 text-sm font-medium whitespace-nowrap transition-colors',
            'border-l border-input first:border-l-0',
            'bg-muted text-muted-foreground hover:text-foreground',
            'has-[[data-state=checked]]:bg-primary has-[[data-state=checked]]:text-primary-foreground',
            'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-inset',
          )}
        >
          <RadioGroupItem id={`${base}-${option.value}`} value={option.value} className="sr-only" />
          {option.label}
        </Label>
      ))}
    </RadioGroup>
  );
}
