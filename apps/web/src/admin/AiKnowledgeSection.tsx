import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { AI_CONTEXT_CHARACTERS, type AiDocument } from '@wa-team-inbox/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AiKnowledgeDraft } from './ai-status';
import { Field } from './adminUi';

/**
 * The two knowledge cards: AI instructions, and Business context (text plus attached files).
 * Presentational: the page owns state and saving.
 */
export function AiKnowledgeSection({
  draft,
  onChange,
  documents,
  disabled,
  uploadDisabled,
  onUpload,
  onRemoveDocument,
}: {
  draft: AiKnowledgeDraft;
  onChange: (next: AiKnowledgeDraft) => void;
  documents: AiDocument[];
  disabled: boolean;
  uploadDisabled: boolean;
  onUpload: (file: File) => void;
  onRemoveDocument: (id: number) => void;
}) {
  const { t, i18n } = useTranslation('admin');
  return (
    <>
      <Card className="gap-4">
        <CardHeader>
          <CardTitle>{t('ai.page.stepInstructions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Field
            label={t('ai.instructions')}
            labelClassName="sr-only"
            hint={t('ai.instructionsHint')}
          >
            {(p) => (
              <Textarea
                {...p}
                value={draft.instructions}
                maxLength={8000}
                rows={4}
                placeholder={t('ai.page.instructionsPlaceholder')}
                disabled={disabled}
                onChange={(e) => onChange({ ...draft, instructions: e.target.value })}
              />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>{t('ai.page.stepContext')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label={t('ai.context')} labelClassName="sr-only" hint={t('ai.contextHint')}>
            {(p) => (
              <Textarea
                {...p}
                value={draft.context}
                maxLength={AI_CONTEXT_CHARACTERS}
                rows={10}
                placeholder={t('ai.page.contextPlaceholder')}
                disabled={disabled}
                onChange={(e) => onChange({ ...draft, context: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('ai.attachFiles')} hint={t('ai.attachFilesHint')}>
            {(p) => (
              <Input
                {...p}
                type="file"
                accept=".txt,.md,.pdf,.docx"
                disabled={disabled || uploadDisabled || documents.length >= 20}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) onUpload(file);
                }}
              />
            )}
          </Field>
          {documents.length > 0 && (
            <ul className="flex flex-col gap-2">
              {documents.map((doc) => (
                <li key={doc.id} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm break-all">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('ai.characters', {
                        number: doc.characters.toLocaleString(i18n.resolvedLanguage),
                      })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon-touch"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={t('ai.removeDocument', { name: doc.name })}
                    onClick={() => onRemoveDocument(doc.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
