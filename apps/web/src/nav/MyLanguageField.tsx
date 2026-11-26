import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  NATIVE,
  TRANSLATE_LANGUAGES,
  useLiveTranslateStatus,
  useMyTranslate,
  useSetMyTranslate,
  type TranslateLanguage,
} from '../api/live-translate';

/**
 * Account → My language and "Send without preview" (off by default). My language defaults to
 * the app language until the person picks one. Hidden while an admin has Live translate off.
 */
export function MyLanguageField() {
  const { t } = useTranslation();
  const status = useLiveTranslateStatus();
  const set = useSetMyTranslate();
  const me = useMyTranslate();
  const id = useId();
  const helpId = useId();
  const skipId = useId();
  const skipHelpId = useId();
  if (!status.data?.enabled) return null;
  return (
    <section
      className="flex flex-col gap-4 rounded-xl border bg-surface p-4"
      data-testid="my-language"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
            <Languages className="size-4 text-muted-foreground" aria-hidden />
            {t('liveTranslate.label')}
          </label>
          <Select
            value={me.myLanguage}
            onValueChange={(v) => set.mutate({ translateLanguage: v as TranslateLanguage })}
          >
            <SelectTrigger id={id} aria-describedby={helpId} className="h-11! w-52 md:h-9!">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {TRANSLATE_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l} lang={l} className="min-h-11 md:min-h-8">
                  {NATIVE[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p id={helpId} className="text-sm text-muted-foreground">
          {t('liveTranslate.help')}
          {!me.myLanguageSet && ` ${t('liveTranslate.default', { lang: NATIVE[me.myLanguage] })}`}
        </p>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor={skipId}>{t('liveTranslate.skipPreview')}</Label>
          <p id={skipHelpId} className="mt-1 text-sm text-muted-foreground">
            {t('liveTranslate.skipPreviewHelp')}
          </p>
        </div>
        <Label
          htmlFor={skipId}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
        >
          <Switch
            id={skipId}
            aria-describedby={skipHelpId}
            checked={me.sendWithoutPreview}
            onCheckedChange={(v) => set.mutate({ sendWithoutPreview: v })}
            data-testid="send-without-preview"
          />
        </Label>
      </div>
    </section>
  );
}
