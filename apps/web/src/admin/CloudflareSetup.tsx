import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { CloudflareCreateBody } from '@wa-team-inbox/shared';
import { errorMessage } from '../api/client';
import {
  useCloudflareAccountAction,
  useCloudflareSetupStatus,
  useCreateCloudflareTunnel,
  type CloudflareAccountAction,
} from '../api/queries';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, Field, Pending } from './adminUi';

function approvalUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://dash.cloudflare.com' &&
      parsed.pathname === '/argotunnel' &&
      !parsed.username &&
      !parsed.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/** Guided account authorization and explicit publication. Credentials remain on the server. */
export function CloudflareSetup() {
  const setup = useCloudflareSetupStatus();
  const account = useCloudflareAccountAction();
  const create = useCreateCloudflareTunnel();
  const [domainId, setDomainId] = useState('');
  const [subdomain, setSubdomain] = useState('inbox');
  const [tunnelName, setTunnelName] = useState('wa-team-inbox');
  const [formError, setFormError] = useState<string | null>(null);
  const prefilled = useRef(false);

  const domains = setup.data?.domains;
  const managed = setup.data?.managed;
  useEffect(() => {
    if (!domains?.length) return;
    if (!prefilled.current) {
      prefilled.current = true;
      const previousDomain = managed
        ? domains.find((domain) => managed.hostname.endsWith(`.${domain.name}`))
        : undefined;
      if (managed && previousDomain) {
        setSubdomain(managed.hostname.slice(0, -(previousDomain.name.length + 1)));
        setTunnelName(managed.name);
      }
    }
  }, [domains, managed]);

  const clearFeedback = () => {
    setFormError(null);
    account.reset();
    create.reset();
  };
  const request = (action: CloudflareAccountAction) => {
    clearFeedback();
    account.mutate(action);
  };

  if (setup.isPending)
    return <Skeleton className="h-32 w-full" aria-label="Loading Cloudflare setup" />;
  if (setup.isError) return <ErrorState error={setup.error} onRetry={() => void setup.refetch()} />;

  const status = setup.data;
  const waiting = status.state === 'signing_in' || status.state === 'awaiting_approval';
  const pendingAction = account.isPending ? account.variables : null;
  const busy = status.busy || account.isPending || create.isPending;
  const selectedDomain =
    status.domains.find((domain) => domain.id === domainId) ??
    status.domains.find((domain) => status.managed?.hostname.endsWith(`.${domain.name}`)) ??
    status.domains[0];
  const address = selectedDomain
    ? `https://${subdomain.trim().toLowerCase()}.${selectedDomain.name}`
    : null;
  const loginUrl = approvalUrl(status.loginUrl);
  const invalidApproval =
    status.loginUrl && !loginUrl
      ? 'The Cloudflare sign-in address could not be verified. Cancel sign-in and try again.'
      : null;
  const actionError = account.error ?? create.error;
  const createdAddress =
    create.data?.url ?? (create.data?.hostname ? `https://${create.data.hostname}` : null);
  const connected = status.state === 'connected';

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-label="Set up your Cloudflare domain">
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">1. Connect your Cloudflare account</h3>
        <p className="text-sm text-muted-foreground">
          Sign in on Cloudflare and approve the domain you want to use. Return here after approval.
          You need a domain already added to your Cloudflare account.
        </p>
        {connected ? (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm text-success">
              Cloudflare account connected.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                size="touch"
                variant="outline"
                disabled={busy}
                onClick={() => request('refresh')}
              >
                <Pending show={pendingAction === 'refresh'} />
                Refresh domains
              </Button>
              <Button size="touch" variant="ghost" disabled={busy} onClick={() => request('login')}>
                Choose another domain
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Only approved domains appear below. Choose another domain starts a new Cloudflare
              approval.
            </p>
          </div>
        ) : waiting ? (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-sm text-muted-foreground">
              {loginUrl
                ? 'Waiting for your approval on Cloudflare…'
                : 'Preparing Cloudflare sign-in…'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {loginUrl && (
                <Button asChild size="touch">
                  <a href={loginUrl} target="_blank" rel="noreferrer">
                    Open Cloudflare sign-in
                    <ExternalLink aria-hidden />
                  </a>
                </Button>
              )}
              <Button
                size="touch"
                variant="outline"
                disabled={pendingAction === 'login/cancel' || create.isPending}
                onClick={() => request('login/cancel')}
              >
                <Pending show={pendingAction === 'login/cancel'} />
                Cancel sign-in
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              This page updates automatically after approval. Keep the app running.
            </p>
          </div>
        ) : (
          <Button
            size="touch"
            className="self-start"
            disabled={busy}
            onClick={() => request('login')}
          >
            <Pending show={pendingAction === 'login'} />
            {status.state === 'error' ? 'Try Cloudflare sign-in again' : 'Sign in to Cloudflare'}
          </Button>
        )}
      </div>

      {(formError || actionError || status.error || invalidApproval) && (
        <Banner tone="danger" title="Cloudflare setup needs attention">
          {formError ??
            (actionError ? errorMessage(actionError) : (status.error ?? invalidApproval))}
        </Banner>
      )}

      {connected && status.domains.length === 0 && (
        <Banner tone="info" title="No approved domain found">
          Add a domain to Cloudflare, then choose another domain to approve it. If you just approved
          a domain, try Refresh domains.
        </Banner>
      )}

      {connected && status.domains.length > 0 && (
        <form
          className="flex min-w-0 flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            clearFeedback();
            const parsed = CloudflareCreateBody.safeParse({
              domainId: selectedDomain?.id,
              subdomain,
              tunnelName,
            });
            if (!parsed.success) {
              setFormError(
                parsed.error.issues[0]?.message ?? 'Check the domain, address and tunnel name.',
              );
              return;
            }
            if (!selectedDomain || busy) return;
            create.mutate(parsed.data);
          }}
        >
          <h3 className="text-base font-semibold">2. Choose your inbox address</h3>
          <Field label="Domain">
            {(props) => (
              <Select value={selectedDomain?.id ?? ''} onValueChange={setDomainId} disabled={busy}>
                <SelectTrigger {...props} className="min-h-11 w-full min-w-0 text-base md:text-sm">
                  <SelectValue placeholder="Choose an approved domain" />
                </SelectTrigger>
                <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
                  {status.domains.map((domain) => (
                    <SelectItem
                      key={domain.id}
                      value={domain.id}
                      className="min-h-11 break-all whitespace-normal"
                    >
                      {domain.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          {selectedDomain?.accountName && (
            <p className="text-sm break-all text-muted-foreground">
              Account: {selectedDomain.accountName}
            </p>
          )}
          <Field
            label="Address prefix"
            hint="A short word before your domain, such as inbox or support."
          >
            {(props) => (
              <Input
                {...props}
                className="h-11"
                value={subdomain}
                maxLength={63}
                onChange={(event) => setSubdomain(event.target.value)}
                disabled={busy}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="inbox"
              />
            )}
          </Field>
          {address && (
            <div className="rounded-lg border bg-muted p-3">
              <p className="mb-1 text-sm text-muted-foreground">Your team will open</p>
              <p className="text-base font-medium break-all" aria-label="Inbox address preview">
                {address}
              </p>
            </div>
          )}
          <Field
            label="Tunnel name"
            hint="A friendly name in Cloudflare so you can recognise this app. It does not change the address."
          >
            {(props) => (
              <Input
                {...props}
                className="h-11"
                value={tunnelName}
                maxLength={64}
                onChange={(event) => setTunnelName(event.target.value)}
                disabled={busy}
                placeholder="wa-team-inbox"
              />
            )}
          </Field>
          <div className="flex flex-col gap-2 border-t pt-4">
            <h3 className="text-base font-semibold">3. Connect your inbox</h3>
            <p className="text-sm text-muted-foreground">
              This publishes the inbox using the address above and sets up its Cloudflare
              connection. Team members still need their normal inbox sign-in. Keep this computer and
              the app running.
            </p>
            <Button
              type="submit"
              size="touch"
              disabled={busy || !selectedDomain || !subdomain.trim() || !tunnelName.trim()}
            >
              <Pending show={create.isPending || status.busy} />
              {create.isPending || status.busy
                ? 'Connecting your inbox…'
                : 'Create and connect inbox'}
            </Button>
          </div>
        </form>
      )}
      {createdAddress && (
        <Banner tone="info" title="Cloudflare connection saved">
          <span className="break-all">{createdAddress}</span>
          <p>Check the connection status above before sharing the address.</p>
        </Banner>
      )}
    </section>
  );
}
