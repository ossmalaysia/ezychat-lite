import { useEffect, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox as InboxIcon, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useUsers } from '../api/queries';
import { Banner, PageHeader, ResponsiveDialog, StatusDot, type StatusTone } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, CopyButton, Field } from './adminUi';
import {
  addInbox,
  removeInbox,
  updateInbox,
  useMockInboxes,
  type InboxStatus,
  type MockInbox,
} from '../mock/inboxes';
import { InboxChip } from '../inbox/InboxChip';

const STATUS_TONE: Record<InboxStatus, StatusTone> = {
  connected: 'success',
  webhook_waiting: 'warning',
  token_invalid: 'danger',
};

/** The public address Meta calls (the mock shows the shop's Phone access domain). */
const callbackUrl = (id: string) =>
  `https://inbox.kopiapong.example/api/ext/whatsapp-cloud/webhook/${id}`;
const verifyTokenFor = (id: string) => `ezc_verify_${id.replaceAll('-', '').slice(-10)}7f3k`;

/**
 * Proposed (multi-inbox): one inbox per WhatsApp number, connected through the WhatsApp Business API
 * (Meta Cloud API). Admin only; agents never see this page.
 */
export function InboxesPage() {
  const { t } = useTranslation('admin');
  const state = useMockInboxes();
  const users = useUsers();
  const [editing, setEditing] = useState<MockInbox | 'new' | null>(null);
  const [removing, setRemoving] = useState<MockInbox | null>(null);

  const people = (users.data ?? []).filter((u) => !u.disabled && u.kind !== 'ai');
  const whoCanOpen = (inbox: MockInbox) =>
    people.filter((u) => {
      if (u.role === 'admin') return true;
      const a = state.access[u.id];
      return Array.isArray(a) && a.includes(inbox.id);
    });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('mockInbox.title')}
        description={t('mockInbox.description')}
        actions={
          <Button
            type="button"
            size="touch"
            className="md:min-h-9"
            onClick={() => setEditing('new')}
          >
            <Plus aria-hidden />
            {t('mockInbox.add')}
          </Button>
        }
      />

      <Banner tone="info" title={t('mockInbox.webhookNeedsDomainTitle')}>
        {t('mockInbox.webhookNeedsDomain')}
      </Banner>

      {state.inboxes.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <InboxIcon className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">{t('mockInbox.emptyTitle')}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t('mockInbox.emptyBody')}</p>
          </CardContent>
        </Card>
      )}

      {state.inboxes.map((inbox) => {
        const open = whoCanOpen(inbox);
        return (
          <Card key={inbox.id} className="gap-4" data-testid="inbox-card">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <InboxChip inbox={inbox} />
                  <span className="text-base font-normal text-muted-foreground tabular-nums">
                    {inbox.number}
                  </span>
                </CardTitle>
                <CardDescription>{t('mockInbox.typeBusinessApi')}</CardDescription>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="touch"
                  className="px-2 md:min-h-8"
                  onClick={() => setEditing(inbox)}
                >
                  {t('mockInbox.edit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="touch"
                  className="px-2 text-danger hover:bg-danger/10 hover:text-danger md:min-h-8"
                  onClick={() => setRemoving(inbox)}
                >
                  {t('mockInbox.remove')}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid max-w-xl grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t('mockInbox.status')}</dt>
                <dd>
                  <StatusDot
                    tone={STATUS_TONE[inbox.status]}
                    label={
                      <span className="font-medium">{t(`mockInbox.state.${inbox.status}`)}</span>
                    }
                  />
                </dd>
                <dt className="text-muted-foreground">{t('mockInbox.whoCanOpen')}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {open.map((u) => (
                    <Badge key={u.id} variant="outline">
                      {u.displayName}
                      {u.role === 'admin' ? ` · ${t('mockInbox.admin')}` : ''}
                    </Badge>
                  ))}
                </dd>
              </dl>
              {inbox.status === 'webhook_waiting' && (
                <Banner tone="warning" title={t('mockInbox.waitingTitle')}>
                  {t('mockInbox.waitingBody')}
                </Banner>
              )}
              {inbox.status === 'token_invalid' && (
                <Banner tone="danger" title={t('mockInbox.tokenInvalidTitle')}>
                  {t('mockInbox.tokenInvalidBody')}
                </Banner>
              )}
              <p className="text-sm text-muted-foreground">{t('mockInbox.accessHint')}</p>
            </CardContent>
          </Card>
        );
      })}

      <InboxDialog inbox={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={removing !== null}
        title={t('mockInbox.removeTitle', { name: removing?.name ?? '' })}
        confirmLabel={t('mockInbox.removeConfirm')}
        danger
        onConfirm={() => {
          if (removing) removeInbox(removing.id);
          toast.success(t('mockInbox.removed'));
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      >
        {t('mockInbox.removeBody')}
      </ConfirmDialog>
    </div>
  );
}

/** Add or edit one Business API inbox: Meta ids and secrets, then the webhook values for Meta. */
function InboxDialog({
  inbox,
  onClose,
}: Readonly<{ inbox: MockInbox | 'new' | null; onClose: () => void }>) {
  const { t } = useTranslation(['admin', 'common']);
  const isNew = inbox === 'new';
  const current = inbox !== null && inbox !== 'new' ? inbox : null;
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState<MockInbox | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setName(current?.name ?? '');
    setNumber(current?.number ?? '');
    setPhoneNumberId(current?.phoneNumberId ?? '');
    setBusinessAccountId(current?.businessAccountId ?? '');
    setToken('');
    setSecret('');
    setSubmitted(false);
    setSaved(current);
  }, [inbox]); // eslint-disable-line react-hooks/exhaustive-deps

  const required = (v: string) =>
    submitted && v.trim() === '' ? t('mockInbox.required') : undefined;
  const digits = (v: string) =>
    submitted && !/^\d{10,20}$/.test(v.trim()) ? t('mockInbox.digitsOnly') : undefined;
  // Editing keeps the stored secrets when the boxes stay empty; a new inbox needs both.
  const secretError = (v: string) => (isNew ? required(v) : undefined);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const invalid =
      !name.trim() ||
      !number.trim() ||
      !/^\d{10,20}$/.test(phoneNumberId.trim()) ||
      !/^\d{10,20}$/.test(businessAccountId.trim()) ||
      (isNew && (!token.trim() || !secret.trim()));
    if (invalid) return;
    const values = {
      name: name.trim(),
      number: number.trim(),
      type: 'business_api' as const,
      phoneNumberId: phoneNumberId.trim(),
      businessAccountId: businessAccountId.trim(),
    };
    if (current) {
      updateInbox(current.id, values);
      setSaved({ ...current, ...values });
      toast.success(t('mockInbox.saved'));
    } else {
      setSaved(addInbox(values));
      toast.success(t('mockInbox.created'));
    }
  };

  const test = () => {
    if (!saved) return;
    setTesting(true);
    // The mock "receives" Meta's verification call after a short wait.
    setTimeout(() => {
      updateInbox(saved.id, { status: 'connected' });
      setSaved({ ...saved, status: 'connected' });
      setTesting(false);
      toast.success(t('mockInbox.testOk'));
    }, 900);
  };

  const formId = 'mock-inbox-form';
  return (
    <ResponsiveDialog
      open={inbox !== null}
      onOpenChange={(next) => !next && close()}
      title={
        isNew && !saved
          ? t('mockInbox.addTitle')
          : t('mockInbox.editTitle', { name: saved?.name ?? name })
      }
      description={t('mockInbox.dialogDescription')}
      size="medium"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="sm:min-h-9"
            onClick={close}
          >
            {saved && isNew ? t('common:actions.done') : t('common:actions.cancel')}
          </Button>
          <Button type="submit" form={formId} size="touch" className="sm:min-h-9">
            {t('mockInbox.save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} noValidate className="flex min-w-0 flex-col gap-5 pb-1">
        <Field label={t('mockInbox.name')} hint={t('mockInbox.nameHint')} error={required(name)}>
          {(p) => (
            <Input {...p} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field
          label={t('mockInbox.number')}
          hint={t('mockInbox.numberHint')}
          error={required(number)}
        >
          {(p) => (
            <Input
              {...p}
              value={number}
              inputMode="tel"
              onChange={(e) => setNumber(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('mockInbox.phoneNumberId')}
          hint={t('mockInbox.phoneNumberIdHint')}
          error={digits(phoneNumberId)}
        >
          {(p) => (
            <Input
              {...p}
              value={phoneNumberId}
              inputMode="numeric"
              onChange={(e) => setPhoneNumberId(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('mockInbox.businessAccountId')}
          hint={t('mockInbox.businessAccountIdHint')}
          error={digits(businessAccountId)}
        >
          {(p) => (
            <Input
              {...p}
              value={businessAccountId}
              inputMode="numeric"
              onChange={(e) => setBusinessAccountId(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('mockInbox.accessToken')}
          hint={isNew ? t('mockInbox.accessTokenHint') : t('mockInbox.keepSecretHint')}
          error={secretError(token)}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="off"
              value={token}
              placeholder={isNew ? '' : '••••••••'}
              onChange={(e) => setToken(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('mockInbox.appSecret')}
          hint={isNew ? t('mockInbox.appSecretHint') : t('mockInbox.keepSecretHint')}
          error={secretError(secret)}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="off"
              value={secret}
              placeholder={isNew ? '' : '••••••••'}
              onChange={(e) => setSecret(e.target.value)}
            />
          )}
        </Field>

        {saved && (
          <div
            className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/40 p-4"
            data-testid="inbox-webhook"
          >
            <p className="font-medium">{t('mockInbox.webhookTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('mockInbox.webhookSteps')}</p>
            <WebhookValue label={t('mockInbox.callbackUrl')} value={callbackUrl(saved.id)} />
            <WebhookValue label={t('mockInbox.verifyToken')} value={verifyTokenFor(saved.id)} />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="md:min-h-9"
                disabled={testing}
                onClick={test}
              >
                {testing ? t('mockInbox.testing') : t('mockInbox.test')}
              </Button>
              <StatusDot
                tone={STATUS_TONE[saved.status]}
                label={<span className="text-sm">{t(`mockInbox.state.${saved.status}`)}</span>}
              />
            </div>
          </div>
        )}
      </form>
    </ResponsiveDialog>
  );

  function close() {
    onClose();
  }
}

function WebhookValue({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]">
          {value}
        </code>
        <CopyButton text={value} className="self-start sm:self-auto" />
      </div>
    </div>
  );
}
