import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

/**
 * Proposed (history-and-message-info, owner 2026-11-26): how many days of chat history WhatsApp
 * imports when a number is linked, asked before the QR code or pairing code. The same control sits
 * in Settings → General. Choices match EzyChat Cloud (`history-days.tsx`: No history, 3, 7, 14, 30)
 * plus **Custom** (0–365): Lite and Enterprise keep the data on the customer's own computer, so
 * there is no 30-day cap. The value is the existing `history_days` setting (default 3).
 */
export const HISTORY_DAY_CHOICES = [0, 3, 7, 14, 30] as const;
export const DEFAULT_HISTORY_DAYS = 3;
export const MAX_HISTORY_DAYS = 365;

type Choice = `${(typeof HISTORY_DAY_CHOICES)[number]}` | 'custom';

/** Whole days 0–365, else null (the field shows an error). */
export function parseHistoryDays(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= MAX_HISTORY_DAYS ? n : null;
}

export function useHistoryDaysLabel(): (days: number) => string {
  const { t } = useTranslation('common');
  return (days) => (days === 0 ? t('mockHistory.none') : t('mockHistory.days', { count: days }));
}

/**
 * The radio rows plus the Custom number box. `value` is the draft as text so a half-typed custom
 * number can stay on screen; `onChange` gets that text. Call `parseHistoryDays` to read it.
 */
export function HistoryImportChoice({
  value,
  onChange,
  showError = false,
  compact = false,
  hint,
}: Readonly<{
  value: string;
  onChange(next: string): void;
  /** Show the 0–365 error (after a try to continue, or while typing in Settings). */
  showError?: boolean;
  /** Settings card: no heading of its own (the card title says it). */
  compact?: boolean;
  /** An extra sentence before the standard hint (Settings: when it applies). */
  hint?: string;
}>) {
  const { t } = useTranslation('common');
  const label = useHistoryDaysLabel();
  const id = useId();
  const parsed = parseHistoryDays(value);
  const preset = HISTORY_DAY_CHOICES.find((d) => String(d) === value.trim());
  // Custom stays chosen while the person types, even when the number equals a preset.
  const [customOpen, setCustomOpen] = useState(preset === undefined);
  const choice: Choice = customOpen ? 'custom' : (String(preset) as Choice);
  const invalid = choice === 'custom' && parsed === null;
  const headingId = `${id}-heading`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex min-w-0 flex-col gap-3 text-left" data-testid="history-import">
      {!compact && (
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 id={headingId} className="text-sm font-medium">
            {t('mockHistory.title')}
          </h3>
        </div>
      )}
      <RadioGroup
        value={choice}
        aria-labelledby={compact ? undefined : headingId}
        aria-label={compact ? t('mockHistory.title') : undefined}
        aria-describedby={hintId}
        onValueChange={(next) => {
          if (next === 'custom') {
            setCustomOpen(true);
            if (parsed === null || preset !== undefined)
              onChange(preset === undefined ? value : '');
          } else {
            setCustomOpen(false);
            onChange(next);
          }
        }}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      >
        {[...HISTORY_DAY_CHOICES.map((d) => String(d) as Choice), 'custom' as const].map((v) => (
          <Label
            key={v}
            htmlFor={`${id}-${v}`}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 md:min-h-9"
          >
            <RadioGroupItem id={`${id}-${v}`} value={v} />
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
              <span className="whitespace-nowrap">
                {v === 'custom' ? t('mockHistory.custom') : label(Number(v))}
              </span>
              {v === String(DEFAULT_HISTORY_DAYS) && (
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                  {t('mockHistory.default')}
                </span>
              )}
            </span>
          </Label>
        ))}
      </RadioGroup>
      {choice === 'custom' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-custom-days`}>{t('mockHistory.customLabel')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-custom-days`}
              type="text"
              inputMode="numeric"
              autoFocus
              aria-invalid={showError && invalid ? true : undefined}
              aria-describedby={showError && invalid ? errorId : `${id}-custom-hint`}
              className="h-11 w-28 md:h-9"
              value={value}
              placeholder="60"
              onChange={(e) => onChange(e.target.value)}
              data-testid="history-custom"
            />
            <span className="text-sm text-muted-foreground">{t('mockHistory.unit')}</span>
          </div>
          {showError && invalid ? (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {t('mockHistory.invalid')}
            </p>
          ) : (
            <p id={`${id}-custom-hint`} className="text-xs text-muted-foreground">
              {t('mockHistory.customHint')}
            </p>
          )}
        </div>
      )}
      <p id={hintId} className="text-sm text-muted-foreground">
        {hint ? `${hint} ` : ''}
        {t('mockHistory.hint')}
        {parsed !== null && parsed > 30 && ` ${t('mockHistory.phoneLimit')}`}
      </p>
    </div>
  );
}

/** "History import: 7 days · Change" above a QR code, after the choice was made. */
export function HistoryChoiceSummary({
  days,
  onChange,
}: Readonly<{ days: number; onChange?: () => void }>) {
  const { t } = useTranslation('common');
  const label = useHistoryDaysLabel();
  return (
    <p
      className={cn('flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground')}
      data-testid="history-summary"
    >
      <History className="size-4 shrink-0" aria-hidden="true" />
      {t('mockHistory.summary', { value: label(days) })}
      {onChange && (
        <Button
          type="button"
          variant="link"
          className="h-auto min-h-11 p-0 md:min-h-0"
          onClick={onChange}
        >
          {t('mockHistory.change')}
        </Button>
      )}
    </p>
  );
}
