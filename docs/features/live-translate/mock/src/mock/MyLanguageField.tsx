import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LANGS,
  NATIVE,
  useLiveTranslateStatus,
  useSetMyLanguage,
  type Lang,
} from './liveTranslate';

/**
 * Proposed (live-translate): Account → My language. Defaults to the app language until the person picks one;
 * hidden while an admin has Live translate off.
 */
export function MyLanguageField() {
  const { t } = useTranslation();
  const status = useLiveTranslateStatus();
  const set = useSetMyLanguage();
  const id = useId();
  const helpId = useId();
  if (!status.data?.enabled) return null;
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border bg-surface p-4"
      data-testid="my-language"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
          <Languages className="size-4 text-muted-foreground" aria-hidden />
          {t('mockTranslate.label')}
        </label>
        <Select value={status.data.myLanguage} onValueChange={(v) => set.mutate(v as Lang)}>
          <SelectTrigger id={id} aria-describedby={helpId} className="h-11! w-52 md:h-9!">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {LANGS.map((l) => (
              <SelectItem key={l} value={l} lang={l} className="min-h-11 md:min-h-8">
                {NATIVE[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p id={helpId} className="text-sm text-muted-foreground">
        {t('mockTranslate.help')}
        {!status.data.myLanguageSet &&
          ` ${t('mockTranslate.default', { lang: NATIVE[status.data.myLanguage] })}`}
      </p>
    </section>
  );
}
