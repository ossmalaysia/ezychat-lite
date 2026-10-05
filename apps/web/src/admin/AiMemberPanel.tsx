import { useState } from 'react';
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
      title={section === 'connection' ? 'Inbox AI connection' : 'AI member'}
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
      setLocalError(parsed.error.issues[0]?.message ?? 'Check the AI settings.');
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
          toast.success(
            section === 'connection' ? 'Inbox AI connection saved.' : 'AI member settings saved.',
          );
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
      setLocalError('Choose a TXT, Markdown, PDF or DOCX document.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setLocalError('Documents must be 10 MB or smaller.');
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
          ? 'Inbox AI connection'
          : status.member
            ? 'Edit AI member'
            : 'Add AI member'
      }
      description={
        section === 'connection'
          ? 'One provider and model configuration is shared by the entire inbox.'
          : 'One AI member can help your team answer basic business questions.'
      }
      footer={
        <>
          <Button variant="outline" size="touch" onClick={onClose} disabled={action.isPending}>
            Close
          </Button>
          <Button type="submit" form="ai-member-form" size="touch" disabled={action.isPending}>
            <Pending show={action.isPending} />
            {section === 'connection' ? 'Save AI connection' : 'Save AI member'}
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
            <p className="text-sm text-muted-foreground">
              Replies after 10 seconds in unassigned customer chats and takes ownership. Assign the
              chat to yourself to take over. The AI resolves a chat only after customer
              confirmation. When it needs help, it assigns an online human with no open chats, or
              returns the chat to unassigned.
            </p>
            <Field label="AI member name">
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
            <p className="text-sm text-muted-foreground">
              Role: Sales Agent — answers basic questions using your business knowledge.
            </p>
            <Field
              label="Enable AI replies"
              hint="Save to apply. Disabling stops automatic replies."
            >
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
            <Banner title="Shared inbox AI connection">
              <p>
                {status.settings.mode === 'api'
                  ? status.hasApiKey
                    ? 'OpenAI API key is saved.'
                    : 'OpenAI API key is not configured.'
                  : `ChatGPT: ${status.connection.state.replaceAll('_', ' ')}`}
              </p>
              <Button asChild size="touch" variant="outline" className="mt-2" onClick={onClose}>
                <Link to="/admin/settings">Configure in Settings → AI</Link>
              </Button>
            </Banner>
          </>
        )}
        {section === 'connection' && (
          <section className="space-y-4" aria-label="AI connection">
            <Field label="Connection mode">
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
                    <SelectItem value="api">OpenAI API key</SelectItem>
                    <SelectItem value="chatgpt">ChatGPT sign-in</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            {settings.mode === 'api' ? (
              <Field
                label="OpenAI API key"
                hint={
                  status.hasApiKey
                    ? 'A key is saved. Leave blank to keep it, or enter a replacement.'
                    : 'Stored securely on the inbox server. API usage is billed separately from ChatGPT.'
                }
              >
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    value={apiKey}
                    autoComplete="new-password"
                    disabled={action.isPending}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={status.hasApiKey ? 'Saved key — hidden' : 'Enter API key'}
                  />
                )}
              </Field>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Sign in through the supported Codex integration. Open the sign-in link in a
                  browser on the computer running the inbox server so the local callback can
                  complete.
                </p>
                <p role="status" className="text-sm">
                  {connectionModeSaved
                    ? `ChatGPT: ${status.connection.state.replaceAll('_', ' ')}`
                    : 'Save the ChatGPT connection mode before signing in.'}
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
                        ? 'Cancel sign-in'
                        : 'Disconnect ChatGPT'}
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
                      Sign in to ChatGPT
                    </Button>
                  )}
                  {connectionModeSaved && loginUrl && (
                    <Button asChild variant="outline" size="touch">
                      <a href={loginUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink aria-hidden />
                        Open sign-in
                      </a>
                    </Button>
                  )}
                </div>
                {status.connection.loginUrl && !loginUrl && (
                  <Banner tone="danger">
                    The sign-in link is invalid. Cancel sign-in and try again.
                  </Banner>
                )}
              </div>
            )}
            <Field
              label="Model (optional)"
              hint={
                settings.mode === 'api'
                  ? 'Leave blank to use gpt-4.1-mini.'
                  : `Leave blank for ${DEFAULT_CHATGPT_MODEL}. Supported: ${CHATGPT_MODELS.join(' or ')}.`
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
          <section className="space-y-4 border-t pt-4" aria-label="Business knowledge">
            <h2 className="font-medium">Business knowledge</h2>
            <Field
              label="AI instructions"
              hint="Describe tone, language and the questions the AI should handle."
            >
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
            <Field
              label="Business notes"
              hint="Add business hours, services, policies and other approved facts."
            >
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
              <h3 className="text-sm font-medium">Frequently asked questions</h3>
              {settings.faqs.map((faq, index) => (
                <div key={index} className="space-y-3 rounded-lg border p-3">
                  <Field label={`Question ${index + 1}`}>
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
                  <Field label={`Answer ${index + 1}`}>
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
                    aria-label={`Remove FAQ ${index + 1}`}
                    onClick={() =>
                      update(
                        'faqs',
                        settings.faqs.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                    Remove FAQ
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
                Add FAQ
              </Button>
            </div>
            <Field
              label="Upload business document"
              hint="TXT, Markdown, PDF or DOCX. Up to 20 files, 10 MB per file; scanned PDFs need selectable text. Save the member first. Documents are available to the AI immediately."
            >
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
                        {doc.characters.toLocaleString()} characters
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon-touch"
                      variant="ghost"
                      disabled={action.isPending}
                      aria-label={`Remove ${doc.name}`}
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
          <Banner tone="danger">
            Cannot refresh AI connection status. {errorMessage(queryError)}
          </Banner>
        )}
        {(localError || action.error) && (
          <Banner tone="danger">{localError ?? errorMessage(action.error)}</Banner>
        )}
      </form>
    </ResponsiveDialog>
  );
}
