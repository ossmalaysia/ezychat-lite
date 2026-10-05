import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type React from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AiMemberBody,
  AiConnectionBody,
  CHATGPT_MODELS,
  DEFAULT_CHATGPT_MODEL,
  type AiMemberStatus,
  type AiSettings,
} from '@wa-team-inbox/shared';
import { Link } from 'react-router-dom';
import { useAiMember, useAiMemberAction } from '../api/ai';
import { errorMessage } from '../api/client';
import { Banner, ResponsiveDialog } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState, Field, ListSkeleton, Pending } from './adminUi';

export function AiMemberPanel({
  onClose,
  section = 'member',
}: {
  onClose: () => void;
  section?: 'member' | 'connection';
}) {
  const { t } = useTranslation('admin');
  const query = useAiMember();
  if (query.data)
    return (
      <AiMemberForm
        status={query.data}
        onClose={onClose}
        section={section}
        queryError={query.isError ? query.error : null}
      />
    );
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={section === 'connection' ? t('ai.connectionTitle') : t('ai.memberTitle')}
    >
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <ListSkeleton />
      )}
    </ResponsiveDialog>
  );
}

function officialLoginUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' &&
      ['auth.openai.com', 'chatgpt.com'].includes(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function AiMemberForm({
  status,
  onClose,
  section,
  queryError,
}: {
  status: AiMemberStatus;
  onClose: () => void;
  section: 'member' | 'connection';
  queryError: unknown;
}) {
  const { t, i18n } = useTranslation('admin');
  const connectionStates = {
    unavailable: t('ai.state.unavailable'),
    signed_out: t('ai.state.signed_out'),
    signing_in: t('ai.state.signing_in'),
    connected: t('ai.state.connected'),
    error: t('ai.state.error'),
  };
  // Connection polling must not replace the admin's unsaved settings.
  const [settings, setSettings] = useState<AiSettings>(status.settings);
  const [apiKey, setApiKey] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const action = useAiMemberAction();
  const update = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) =>
    setSettings((old) => ({ ...old, [key]: value }));
  const loginUrl = officialLoginUrl(status.connection.loginUrl);
  const connectionModeSaved = settings.mode === status.settings.mode;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const parsed = (section === 'connection' ? AiConnectionBody : AiMemberBody).safeParse({
      ...settings,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
    if (!parsed.success) {
      setLocalError(
        settings.mode === 'chatgpt' && parsed.error.issues[0]?.path[0] === 'model'
          ? t('ai.modelInvalid', { models: CHATGPT_MODELS.join(t('ai.modelSeparator')) })
          : t('ai.checkSettings'),
      );
      return;
    }
    action.mutate(
      section === 'connection'
        ? { kind: 'connection', settings: AiConnectionBody.parse(parsed.data) }
        : { kind: 'save', settings: AiMemberBody.parse(parsed.data) },
      {
        onSuccess: (saved) => {
          setSettings(saved.settings);
          setApiKey('');
          toast.success(section === 'connection' ? t('ai.connectionSaved') : t('ai.memberSaved'));
        },
      },
    );
  };

  const upload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLocalError(null);
    if (!/\.(txt|md|pdf|docx)$/i.test(file.name)) {
      setLocalError(t('ai.fileTypeError'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setLocalError(t('ai.fileSizeError'));
      return;
    }
    action.mutate({ kind: 'upload', file });
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => !open && !action.isPending && onClose()}
      title={
        section === 'connection'
          ? t('ai.connectionTitle')
          : status.member
            ? t('ai.editMember')
            : t('ai.addMember')
      }
      description={
        section === 'connection' ? t('ai.connectionDescription') : t('ai.memberDescription')
      }
      footer={
        <>
          <Button variant="outline" size="touch" onClick={onClose} disabled={action.isPending}>
            {t('ai.close')}
          </Button>
          <Button type="submit" form="ai-member-form" size="touch" disabled={action.isPending}>
            <Pending show={action.isPending} />
            {section === 'connection' ? t('ai.saveConnection') : t('ai.saveMember')}
          </Button>
        </>
      }
    >
      <form
        id="ai-member-form"
        onSubmit={submit}
        className="max-h-[60dvh] space-y-5 overflow-y-auto pb-1 pr-1"
      >
        {section === 'member' && (
          <>
            <p className="text-sm text-muted-foreground">{t('ai.behavior')}</p>
            <Field label={t('ai.memberName')}>
              {(p) => (
                <Input
                  {...p}
                  value={settings.displayName}
                  maxLength={64}
                  required
                  disabled={action.isPending}
                  onChange={(e) => update('displayName', e.target.value)}
                />
              )}
            </Field>
            <p className="text-sm text-muted-foreground">{t('ai.roleDescription')}</p>
            <Field label={t('ai.enable')} hint={t('ai.enableHint')}>
              {(p) => (
                <Label
                  htmlFor={p.id}
                  className="inline-flex min-h-11 min-w-11 self-start items-center justify-center"
                >
                  <Switch
                    {...p}
                    checked={settings.enabled}
                    disabled={action.isPending}
                    onCheckedChange={(value) => update('enabled', value)}
                  />
                </Label>
              )}
            </Field>
            <Banner title={t('ai.sharedConnection')}>
              <p>
                {status.settings.mode === 'api'
                  ? status.hasApiKey
                    ? t('ai.keySaved')
                    : t('ai.keyMissing')
                  : t('ai.chatgptState', { state: connectionStates[status.connection.state] })}
              </p>
              <Button asChild size="touch" variant="outline" className="mt-2" onClick={onClose}>
                <Link to="/admin/settings">{t('ai.configureInSettings')}</Link>
              </Button>
            </Banner>
          </>
        )}
        {section === 'connection' && (
          <section className="space-y-4" aria-label={t('ai.connectionLabel')}>
            <Field label={t('ai.connectionMode')}>
              {(p) => (
                <Select
                  value={settings.mode}
                  disabled={action.isPending}
                  onValueChange={(mode) =>
                    setSettings((old) => ({
                      ...old,
                      mode: mode as AiSettings['mode'],
                      model: old.mode === mode ? old.model : '',
                    }))
                  }
                >
                  <SelectTrigger {...p} className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api">{t('ai.apiKey')}</SelectItem>
                    <SelectItem value="chatgpt">{t('ai.chatgptMode')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            {settings.mode === 'api' ? (
              <Field
                label={t('ai.apiKey')}
                hint={status.hasApiKey ? t('ai.keepKeyHint') : t('ai.apiKeyHint')}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    value={apiKey}
                    autoComplete="new-password"
                    disabled={action.isPending}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={status.hasApiKey ? t('ai.hiddenKey') : t('ai.enterKey')}
                  />
                )}
              </Field>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t('ai.loginHint')}</p>
                <p role="status" className="text-sm">
                  {connectionModeSaved
                    ? t('ai.chatgptState', { state: connectionStates[status.connection.state] })
                    : t('ai.saveModeFirst')}
                </p>
                {connectionModeSaved && status.connection.error && (
                  <Banner tone="danger">{status.connection.error}</Banner>
                )}
                <div className="flex flex-wrap gap-2">
                  {connectionModeSaved &&
                  (status.connection.state === 'connected' ||
                    status.connection.state === 'signing_in') ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="touch"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ kind: 'logout' })}
                    >
                      {status.connection.state === 'signing_in'
                        ? t('ai.cancelLogin')
                        : t('ai.disconnect')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="touch"
                      disabled={
                        !connectionModeSaved ||
                        action.isPending ||
                        status.connection.state === 'unavailable'
                      }
                      onClick={() => action.mutate({ kind: 'login' })}
                    >
                      {t('ai.login')}
                    </Button>
                  )}
                  {connectionModeSaved && loginUrl && (
                    <Button asChild variant="outline" size="touch">
                      <a href={loginUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink aria-hidden />
                        {t('ai.openLogin')}
                      </a>
                    </Button>
                  )}
                </div>
                {status.connection.loginUrl && !loginUrl && (
                  <Banner tone="danger">{t('ai.invalidLink')}</Banner>
                )}
              </div>
            )}
            <Field
              label={t('ai.model')}
              hint={
                settings.mode === 'api'
                  ? t('ai.apiModelHint')
                  : t('ai.chatgptModelHint', {
                      model: DEFAULT_CHATGPT_MODEL,
                      models: CHATGPT_MODELS.join(t('ai.modelSeparator')),
                    })
              }
            >
              {(p) => (
                <Input
                  {...p}
                  value={settings.model}
                  maxLength={128}
                  disabled={action.isPending}
                  onChange={(e) => update('model', e.target.value)}
                />
              )}
            </Field>
          </section>
        )}
        {section === 'member' && (
          <section className="space-y-4 border-t pt-4" aria-label={t('ai.knowledge')}>
            <h2 className="font-medium">{t('ai.knowledge')}</h2>
            <Field label={t('ai.instructions')} hint={t('ai.instructionsHint')}>
              {(p) => (
                <Textarea
                  {...p}
                  value={settings.instructions}
                  maxLength={8000}
                  disabled={action.isPending}
                  onChange={(e) => update('instructions', e.target.value)}
                />
              )}
            </Field>
            <Field label={t('ai.notes')} hint={t('ai.notesHint')}>
              {(p) => (
                <Textarea
                  {...p}
                  value={settings.notes}
                  maxLength={30000}
                  rows={5}
                  disabled={action.isPending}
                  onChange={(e) => update('notes', e.target.value)}
                />
              )}
            </Field>
            <div className="space-y-3">
              <h3 className="text-sm font-medium">{t('ai.faqs')}</h3>
              {settings.faqs.map((faq, index) => (
                <div key={index} className="space-y-3 rounded-lg border p-3">
                  <Field label={t('ai.question', { number: index + 1 })}>
                    {(p) => (
                      <Input
                        {...p}
                        value={faq.question}
                        maxLength={500}
                        required
                        disabled={action.isPending}
                        onChange={(e) =>
                          update(
                            'faqs',
                            settings.faqs.map((item, i) =>
                              i === index ? { ...item, question: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label={t('ai.answer', { number: index + 1 })}>
                    {(p) => (
                      <Textarea
                        {...p}
                        value={faq.answer}
                        maxLength={4000}
                        required
                        disabled={action.isPending}
                        onChange={(e) =>
                          update(
                            'faqs',
                            settings.faqs.map((item, i) =>
                              i === index ? { ...item, answer: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Button
                    type="button"
                    size="touch"
                    variant="ghost"
                    disabled={action.isPending}
                    aria-label={t('ai.removeFaqLabel', { number: index + 1 })}
                    onClick={() =>
                      update(
                        'faqs',
                        settings.faqs.filter((_, i) => i !== index),
                      )
                    }
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
                disabled={action.isPending || settings.faqs.length >= 100}
                onClick={() => update('faqs', [...settings.faqs, { question: '', answer: '' }])}
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
                  disabled={action.isPending || !status.member || status.documents.length >= 20}
                  onChange={upload}
                />
              )}
            </Field>
            {status.documents.length > 0 && (
              <ul className="space-y-2">
                {status.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex min-w-0 items-center gap-2 rounded-lg border p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm">{doc.name}</p>
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
                      disabled={action.isPending}
                      aria-label={t('ai.removeDocument', { name: doc.name })}
                      onClick={() => action.mutate({ kind: 'remove', id: doc.id })}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {Boolean(queryError) && (
          <Banner tone="danger">{t('ai.refreshError', { error: errorMessage(queryError) })}</Banner>
        )}
        {(localError || action.error) && (
          <Banner tone="danger">{localError ?? errorMessage(action.error)}</Banner>
        )}
      </form>
    </ResponsiveDialog>
  );
}
