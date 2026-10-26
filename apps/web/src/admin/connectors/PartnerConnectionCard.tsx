import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  Plug,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  connectorText,
  type ConnectorAuth,
  type ConnectorConnectionView,
  type ConnectorEntry,
  type ConnectorProblem,
  type ConnectorTestResult,
  type GalleryConnector,
} from '@ezychat/shared';
import { errorMessage } from '../../api/client';
import {
  connectorProblemOf as problemOf,
  connectorListKey,
  useConnectorConnect,
  useConnectorConnectProgress,
  useConnectorDisconnect,
  useConnectorTest,
} from '../../api/connector-list';
import { Banner, ResponsiveDialog, StatusDot } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatRelative } from '@/lib/format';
import { ConfirmDialog, Field, Pending } from '../adminUi';
import { isLinked } from './list';

/** Why a sign-in or a test did not work: a partner problem, or an unknown error. */
type Problem = ConnectorProblem | 'error';

interface Signing {
  requestId: string;
  url: string;
  /** The browser blocked the new window: the person opens the link themselves. */
  blocked: boolean;
}

/**
 * OAuth sign-in: a window opens inside the click (so the browser allows it), then goes to the
 * partner's page once the server answers; the page polls until the partner sent the person back.
 */
function useOAuthFlow(entry: ConnectorEntry) {
  const { t } = useTranslation('admin');
  const qc = useQueryClient();
  const start = useConnectorConnect(entry.id);
  const [signing, setSigning] = useState<Signing | null>(null);
  const [failed, setFailed] = useState<Problem | null>(null);
  const progress = useConnectorConnectProgress(entry.id, signing?.requestId ?? null);
  const status = progress.data?.status;
  const problem = progress.data?.problem ?? null;

  useEffect(() => {
    if (!signing || !status || status === 'pending') return;
    setSigning(null);
    if (status === 'done') {
      setFailed(null);
      toast.success(t('connectors.partner.connectedToast', { name: entry.name }));
    } else setFailed(problem ?? 'error');
    void qc.invalidateQueries({ queryKey: connectorListKey });
  }, [signing, status, problem, qc, t, entry.name]);

  /** Starts the sign-in; call it straight from a click. Resolves false when it did not start. */
  const begin = async (fields: Record<string, string>): Promise<boolean> => {
    setFailed(null);
    const tab = window.open('about:blank', '_blank');
    try {
      const next = await start.mutateAsync({ fields });
      if (next.authorizationUrl && next.requestId) {
        if (tab) {
          tab.opener = null;
          tab.location.href = next.authorizationUrl;
        }
        setSigning({ requestId: next.requestId, url: next.authorizationUrl, blocked: !tab });
      } else {
        tab?.close();
        if (next.connection.state === 'connected')
          toast.success(t('connectors.partner.connectedToast', { name: entry.name }));
      }
      return true;
    } catch (error) {
      tab?.close();
      setFailed(problemOf(error));
      return false;
    }
  };

  return {
    begin,
    cancel: () => setSigning(null),
    signing,
    failed,
    starting: start.isPending,
    startError: problemOf(start.error) ? null : start.error,
    progressError: progress.error,
  };
}

/** The sign-in banner texts of a problem (cancelled, unreachable, refused, …). */
function ProblemBanner({ problem, entry }: { problem: Problem; entry: ConnectorEntry }) {
  const { t } = useTranslation('admin');
  const name = entry.name;
  const publisher = entry.publisher ?? entry.name;
  if (problem === 'cancelled')
    return (
      <Banner tone="warning" title={t('connectors.partner.cancelledTitle')}>
        {t('connectors.partner.cancelledBody')}
      </Banner>
    );
  if (problem === 'unreachable')
    return (
      <Banner tone="warning" title={t('connectors.partner.unreachableTitle', { name })}>
        {t('connectors.partner.unreachableBody', { publisher })}
      </Banner>
    );
  return (
    <Banner tone="danger">
      <span data-testid={`connector-problem-${problem}`}>
        {t(`connectors.partner.problem.${problem}`, { name, publisher })}
      </span>
    </Banner>
  );
}

/**
 * Overview → Connection of a partner connector: Connect for its sign-in type (the partner's page,
 * an API key, a form or nothing), the waiting card while the partner's page is open, the account
 * or key end once connected, Test connection and Disconnect.
 */
export function PartnerConnectionCard({
  g,
  onOpenSettings,
}: {
  g: GalleryConnector;
  onOpenSettings: () => void;
}) {
  const { t, i18n } = useTranslation('admin');
  const { entry, connection } = g;
  const auth: ConnectorAuth = entry.auth ?? { type: 'none' };
  const name = entry.name;
  const publisher = entry.publisher ?? entry.name;
  const flow = useOAuthFlow(entry);
  const connectNone = useConnectorConnect(entry.id);
  const test = useConnectorTest(entry.id);
  const disconnect = useConnectorDisconnect(entry.id);
  const [dialog, setDialog] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const linked = isLinked(connection);
  const state = connection?.state;
  const oauth = auth.type === 'oauth';
  const busy = flow.starting || connectNone.isPending || flow.signing !== null;
  const connectLabel =
    auth.type === 'api_key'
      ? t('connectors.partner.connectKey')
      : auth.type === 'credentials'
        ? t('connectors.partner.connectForm')
        : auth.type === 'oauth_own_app'
          ? t('connectors.partner.connectOwnApp')
          : t('connectors.partner.connect', { name });

  const connect = () => {
    if (auth.type === 'oauth') return void flow.begin({});
    if (auth.type === 'none')
      return connectNone.mutate(
        { fields: {} },
        {
          onSuccess: (result) => {
            if (result.connection.state === 'connected')
              toast.success(t('connectors.partner.connectedToast', { name }));
          },
        },
      );
    setDialog(true);
  };

  const runTest = () => {
    test.reset();
    test.mutate({ fields: {} });
  };

  const connectButton = (label: string, outline = false) => (
    <Button
      size="touch"
      variant={outline ? 'outline' : 'default'}
      className="self-start"
      disabled={busy}
      onClick={connect}
      data-testid="partner-connect"
    >
      {busy ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : oauth || auth.type === 'oauth_own_app' ? (
        <LogIn aria-hidden />
      ) : auth.type === 'none' ? (
        <Plug aria-hidden />
      ) : (
        <KeyRound aria-hidden />
      )}
      {label}
    </Button>
  );

  return (
    <Card data-testid="partner-connection">
      <CardHeader>
        <CardTitle>{t('connectors.partner.connectionTitle')}</CardTitle>
        <CardDescription>
          {t(`connectors.partner.connection.${auth.type}`, { name, publisher })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {flow.failed && <ProblemBanner problem={flow.failed} entry={entry} />}
        {flow.signing && (
          <div
            className="flex flex-col items-start gap-3 rounded-lg border px-3 py-3"
            role="status"
            data-testid="partner-waiting"
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
              {t('connectors.partner.waitingTitle')}
            </p>
            <p className="text-sm text-muted-foreground">
              {flow.signing.blocked
                ? t('connectors.partner.blocked')
                : t('connectors.partner.waitingBody', { name })}
            </p>
            <Button asChild size="touch" variant={flow.signing.blocked ? 'default' : 'outline'}>
              <a href={flow.signing.url} target="_blank" rel="noopener noreferrer">
                {t('connectors.partner.openSignIn')}
                <ExternalLink aria-hidden />
              </a>
            </Button>
            <Button size="touch" variant="ghost" onClick={flow.cancel}>
              {t('connectors.partner.cancel')}
            </Button>
          </div>
        )}
        {linked && connection && (
          <Connected
            entry={entry}
            auth={auth}
            connection={connection}
            onOpenSettings={onOpenSettings}
          />
        )}
        {state === 'needs_sign_in' && !flow.signing && (
          <Banner tone="warning" title={t('connectors.partner.needsSignInTitle')}>
            <span className="flex flex-col items-start gap-2">
              {t('connectors.partner.needsSignInBody', { name })}
              {!g.delisted &&
                connectButton(
                  oauth || auth.type === 'oauth_own_app'
                    ? t('connectors.partner.signInAgain')
                    : connectLabel,
                  true,
                )}
            </span>
          </Banner>
        )}
        {state === 'unreachable' && (
          <Banner tone="warning" title={t('connectors.partner.unreachableTitle', { name })}>
            {t('connectors.partner.unreachableBody', { publisher })}
          </Banner>
        )}
        {linked && (
          <>
            <TestResult result={test.data} entry={entry} />
            {test.error && <Banner tone="danger">{errorMessage(test.error)}</Banner>}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="touch"
                variant="outline"
                disabled={test.isPending}
                onClick={runTest}
                data-testid="partner-test"
              >
                {test.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Stethoscope aria-hidden />
                )}
                {t('connectors.partner.testConnection')}
              </Button>
              {(auth.type === 'api_key' || auth.type === 'credentials') && !g.delisted && (
                <Button size="touch" variant="outline" onClick={() => setDialog(true)}>
                  <KeyRound aria-hidden />
                  {auth.type === 'api_key'
                    ? t('connectors.partner.replaceKey')
                    : t('connectors.partner.changeDetails')}
                </Button>
              )}
              <Button
                size="touch"
                variant="outline"
                onClick={() => setConfirmDisconnect(true)}
                data-testid="partner-disconnect"
              >
                {t('connectors.partner.disconnect')}
              </Button>
            </div>
          </>
        )}
        {!linked && !flow.signing && (
          <>
            {entry.privacy && (
              <p className="flex items-start gap-2 text-sm" data-testid="privacy-before-connect">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="break-words">{connectorText(entry.privacy, i18n.language)}</span>
              </p>
            )}
            {g.delisted
              ? null
              : connectButton(flow.failed ? t('connectors.partner.tryAgain') : connectLabel)}
            <p className="text-sm text-muted-foreground">
              {t(`connectors.partner.hint.${auth.type}`, { name, publisher })}
            </p>
          </>
        )}
        {flow.startError != null && <Banner tone="danger">{errorMessage(flow.startError)}</Banner>}
        {flow.progressError && <Banner tone="danger">{errorMessage(flow.progressError)}</Banner>}
        {connectNone.error &&
          (problemOf(connectNone.error) ? (
            <ProblemBanner problem={problemOf(connectNone.error)!} entry={entry} />
          ) : (
            <Banner tone="danger">{errorMessage(connectNone.error)}</Banner>
          ))}
      </CardContent>
      {auth.type !== 'oauth' && auth.type !== 'none' && (
        <ConnectDialog
          entry={entry}
          auth={auth}
          open={dialog}
          onOpenChange={setDialog}
          replacing={linked}
          beginSignIn={flow.begin}
        />
      )}
      <ConfirmDialog
        open={confirmDisconnect}
        title={t('connectors.partner.disconnectTitle', { name })}
        confirmLabel={t('connectors.partner.disconnect')}
        danger
        loading={disconnect.isPending}
        error={disconnect.error}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => {
              setConfirmDisconnect(false);
              test.reset();
              toast.success(t('connectors.partner.disconnected', { name }));
            },
          })
        }
      >
        {t('connectors.partner.disconnectBody', { name })}
      </ConfirmDialog>
    </Card>
  );
}

/** The account (or key end), the non-secret fields and since when it is connected. */
function Connected({
  entry,
  auth,
  connection,
  onOpenSettings,
}: {
  entry: ConnectorEntry;
  auth: ConnectorAuth;
  connection: ConnectorConnectionView;
  onOpenSettings: () => void;
}) {
  const { t, i18n } = useTranslation('admin');
  const fields = auth.type === 'credentials' ? auth.fields.filter((f) => !f.secret) : [];
  const shown = fields.filter((f) => connection.fields[f.id]);
  const ok = connection.state === 'connected';
  return (
    <>
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-3"
        data-testid="partner-connected"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          {connection.account ? (
            <>
              <span className="text-sm text-muted-foreground">
                {t('connectors.partner.account')}
              </span>
              <span className="font-medium break-all">{connection.account}</span>
            </>
          ) : connection.keyEnd ? (
            <>
              <span className="text-sm text-muted-foreground">{t('connectors.partner.key')}</span>
              <span className="font-medium break-all">
                {t('connectors.partner.keyEnding', { end: connection.keyEnd })}
              </span>
            </>
          ) : (
            <span className="font-medium break-words">{entry.name}</span>
          )}
        </div>
        <span className="flex items-center gap-2 text-sm">
          <StatusDot tone={ok ? 'success' : 'warning'} />
          {t(ok ? 'connectors.status.connected' : 'connectors.status.attention')}
        </span>
      </div>
      {shown.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {shown.map((f) => (
            <div key={f.id} className="contents">
              <dt className="text-muted-foreground">{connectorText(f.label, i18n.language)}</dt>
              <dd className="break-all">{connection.fields[f.id]}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-sm text-muted-foreground">
        {connection.connectedAt !== null &&
          `${t('connectors.partner.connectedSince', { when: formatRelative(connection.connectedAt) })} `}
        <Button variant="link" className="h-auto p-0 align-baseline" onClick={onOpenSettings}>
          {t('connectors.partner.openSettings')}
        </Button>
      </p>
    </>
  );
}

/** Test connection: works (with the number of tools), or why not. */
function TestResult({
  result,
  entry,
}: {
  result: ConnectorTestResult | undefined;
  entry: ConnectorEntry;
}) {
  const { t } = useTranslation('admin');
  if (!result) return null;
  if (result.ok)
    return (
      <p className="flex items-center gap-2 text-sm text-success" role="status">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        {t('connectors.partner.testOk', { count: result.tools.length })}
      </p>
    );
  return <ProblemBanner problem={result.problem ?? 'error'} entry={entry} />;
}

interface DialogField {
  id: string;
  label: string;
  hint?: string;
  secret: boolean;
}

/**
 * The sign-in dialog of the key and form types: API key (one key), credentials (the entry's
 * fields; secret ones as password boxes) and own app (client ID and secret, then the partner's
 * sign-in page). Test checks the typed values first; Save stores them encrypted on this computer.
 */
function ConnectDialog({
  entry,
  auth,
  open,
  onOpenChange,
  replacing,
  beginSignIn,
}: {
  entry: ConnectorEntry;
  auth: Exclude<ConnectorAuth, { type: 'oauth' } | { type: 'none' }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replacing: boolean;
  beginSignIn: (fields: Record<string, string>) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation('admin');
  const save = useConnectorConnect(entry.id);
  const test = useConnectorTest(entry.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [tested, setTested] = useState<{ result: ConnectorTestResult; values: string } | null>(
    null,
  );
  const [saveProblem, setSaveProblem] = useState<Problem | null>(null);
  const name = entry.name;
  const ownApp = auth.type === 'oauth_own_app';
  const fields: DialogField[] =
    auth.type === 'api_key'
      ? [
          {
            id: 'key',
            label: connectorText(auth.label, i18n.language) || t('connectors.partner.key'),
            hint: t('connectors.partner.keyStored'),
            secret: true,
          },
        ]
      : auth.type === 'credentials'
        ? auth.fields.map((f) => ({
            id: f.id,
            label: connectorText(f.label, i18n.language),
            hint: f.hint ? connectorText(f.hint, i18n.language) : undefined,
            secret: f.secret,
          }))
        : [
            { id: 'clientId', label: t('connectors.partner.clientId'), secret: false },
            {
              id: 'clientSecret',
              label: t('connectors.partner.clientSecret'),
              hint: t('connectors.partner.keyStored'),
              secret: true,
            },
          ];
  const snapshot = JSON.stringify(values);
  const shown = tested && tested.values === snapshot ? tested.result : null;
  const busy = save.isPending || test.isPending;

  const close = (next: boolean) => {
    if (!next) {
      setValues({});
      setMissing([]);
      setTested(null);
      setSaveProblem(null);
      save.reset();
      test.reset();
    }
    onOpenChange(next);
  };

  const filled = () => {
    const empty = fields.filter((f) => !values[f.id]?.trim()).map((f) => f.id);
    setMissing(empty);
    return empty.length === 0;
  };
  const body = () => Object.fromEntries(fields.map((f) => [f.id, (values[f.id] ?? '').trim()]));

  const runTest = () => {
    if (!filled()) return;
    setSaveProblem(null);
    const at = snapshot;
    test.mutate({ fields: body() }, { onSuccess: (result) => setTested({ result, values: at }) });
  };

  const submit = () => {
    if (!filled()) return;
    setSaveProblem(null);
    if (ownApp) {
      void beginSignIn(body()).then((started) => {
        if (started) close(false);
      });
      return;
    }
    save.mutate(
      { fields: body() },
      {
        onSuccess: (result) => {
          if (result.connection.state === 'connected') {
            close(false);
            toast.success(t('connectors.partner.connectedToast', { name }));
          } else
            setSaveProblem(result.connection.state === 'unreachable' ? 'unreachable' : 'refused');
        },
        onError: (error) => setSaveProblem(problemOf(error)),
      },
    );
  };

  const problem: Problem | null =
    saveProblem ?? (shown && !shown.ok ? (shown.problem ?? 'error') : null);
  // A refused key shows at its field; other problems above the buttons.
  const refusedAtField = problem === 'refused' && auth.type === 'api_key';
  const otherError = save.error && !problemOf(save.error) ? save.error : test.error;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title={
        ownApp
          ? t('connectors.partner.ownAppTitle', { name })
          : replacing
            ? auth.type === 'api_key'
              ? t('connectors.partner.replaceKeyTitle', { name })
              : t('connectors.partner.changeDetailsTitle', { name })
            : t('connectors.partner.dialogTitle', { name })
      }
      description={t(`connectors.partner.dialogBody.${auth.type}`, {
        name,
        publisher: entry.publisher ?? name,
      })}
      footer={
        <>
          <Button size="touch" variant="outline" onClick={() => close(false)}>
            {t('connectors.partner.cancel')}
          </Button>
          {!ownApp && (
            <Button
              size="touch"
              variant="outline"
              disabled={busy}
              onClick={runTest}
              data-testid="connect-test"
            >
              <Pending show={test.isPending} />
              {t('connectors.partner.test')}
            </Button>
          )}
          <Button size="touch" disabled={busy} onClick={submit} data-testid="connect-save">
            <Pending show={save.isPending} />
            {ownApp ? t('connectors.partner.saveAndSignIn') : t('connectors.partner.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2" data-testid="connect-dialog">
        {fields.map((f) => (
          <Field
            key={f.id}
            label={f.label}
            hint={f.hint}
            error={
              missing.includes(f.id)
                ? t('connectors.partner.required')
                : refusedAtField
                  ? t('connectors.partner.keyRefused', { name })
                  : undefined
            }
          >
            {(p) => (
              <Input
                {...p}
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={values[f.id] ?? ''}
                maxLength={4000}
                className={f.secret ? 'min-h-11 font-mono' : 'min-h-11'}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                data-testid={`connect-field-${f.id}`}
              />
            )}
          </Field>
        ))}
        {auth.help && (
          <a
            href={auth.help}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-primary underline-offset-4 hover:underline md:min-h-0"
          >
            {t(`connectors.partner.help.${auth.type}`, { name })}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
        {shown?.ok && !saveProblem && (
          <p className="flex items-center gap-2 text-sm text-success" role="status">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            {t('connectors.partner.testOk', { count: shown.tools.length })}
          </p>
        )}
        {problem && !refusedAtField && <ProblemBanner problem={problem} entry={entry} />}
        {otherError && <Banner tone="danger">{errorMessage(otherError)}</Banner>}
      </div>
    </ResponsiveDialog>
  );
}
