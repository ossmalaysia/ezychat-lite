import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { AiDocument } from '@wa-team-inbox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AiKnowledgeDraft } from './ai-status';
import { Field } from './adminUi';

/** Instructions, notes, FAQs and documents. Presentational: the page owns state and saving. */
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
  const setFaq = (index: number, key: 'question' | 'answer', value: string) =>
    onChange({
      ...draft,
      faqs: draft.faqs.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    });
  return (
    <div className="flex flex-col gap-4">
      <Field label={t('ai.instructions')} hint={t('ai.instructionsHint')}>
        {(p) => (
          <Textarea
            {...p}
            value={draft.instructions}
            maxLength={8000}
            placeholder={t('ai.page.instructionsPlaceholder')}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, instructions: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('ai.notes')} hint={t('ai.notesHint')}>
        {(p) => (
          <Textarea
            {...p}
            value={draft.notes}
            maxLength={30000}
            rows={5}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, notes: e.target.value })}
          />
        )}
      </Field>
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t('ai.faqs')}</h3>
        {draft.faqs.map((faq, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-lg border p-3">
            <Field label={t('ai.question', { number: index + 1 })}>
              {(p) => (
                <Input
                  {...p}
                  value={faq.question}
                  maxLength={500}
                  disabled={disabled}
                  onChange={(e) => setFaq(index, 'question', e.target.value)}
                />
              )}
            </Field>
            <Field label={t('ai.answer', { number: index + 1 })}>
              {(p) => (
                <Textarea
                  {...p}
                  value={faq.answer}
                  maxLength={4000}
                  disabled={disabled}
                  onChange={(e) => setFaq(index, 'answer', e.target.value)}
                />
              )}
            </Field>
            <Button
              type="button"
              size="touch"
              variant="ghost"
              className="self-start"
              disabled={disabled}
              aria-label={t('ai.removeFaqLabel', { number: index + 1 })}
              onClick={() => onChange({ ...draft, faqs: draft.faqs.filter((_, i) => i !== index) })}
            >
              <Trash2 aria-hidden />
              {t('ai.removeFaq')}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="touch"
          className="self-start"
          disabled={disabled || draft.faqs.length >= 100}
          onClick={() =>
            onChange({ ...draft, faqs: [...draft.faqs, { question: '', answer: '' }] })
          }
        >
          <Plus aria-hidden />
          {t('ai.addFaq')}
        </Button>
      </div>
      <Field label={t('ai.upload')} hint={t('ai.uploadHint')}>
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
    </div>
  );
}
