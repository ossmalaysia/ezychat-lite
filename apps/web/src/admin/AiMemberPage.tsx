import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { AiMemberBody, type AiMemberStatus, type AiSettings } from '@wa-team-inbox/shared';
import { useAiMember, useAiMemberAction } from '../api/ai';
import { errorMessage } from '../api/client';
import { Banner, PageHeader, StatusDot } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AiConnectionBanner } from './AiConnectionBanner';
import { AiKnowledgeSection } from './AiKnowledgeSection';
import { AiTryIt } from './AiTryIt';
import { connectionReady, hasKnowledge, memberPill, type AiKnowledgeDraft } from './ai-status';
import { ErrorState, Field, ListSkeleton, Pending } from './adminUi';

const PILL_TONE = {
  on: 'success',
  off: 'muted',
  needsConnection: 'danger',
  needsKnowledge: 'warning',
} as const;
const draftFrom = (s: AiSettings): AiKnowledgeDraft => ({
  displayName: s.displayName,
  instructions: s.instructions,
  notes: s.notes,
  faqs: s.faqs,
});
const draftKey = (s: AiMemberStatus) => `wati.ai-draft.${s.member?.id ?? 'new'}`;
/** Unsaved edits survive leaving the page (the app's router cannot block navigation). */
function readStoredDraft(key: string): AiKnowledgeDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = AiMemberBody.pick({
      displayName: true,
      instructions: true,
      notes: true,
      faqs: true,
    }).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function writeStoredDraft(key: string, draft: AiKnowledgeDraft | null) {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: edits just are not restored */
  }
}
const same = (a: AiKnowledgeDraft, b: AiKnowledgeDraft) => JSON.stringify(a) === JSON.stringify(b);

/** Members ▸ AI Sales Agent: set up, test and turn on the AI member (replaces the popup). */
export function AiMemberPage() {
  const query = useAiMember();
  if (!query.data)
    return query.isError ? (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <ListSkeleton />
    );
  return <AiMemberEditor status={query.data} refreshError={query.isError ? query.error : null} />;
}

function AiMemberEditor({
  status,
  refreshError,
}: {
  status: AiMemberStatus;
  refreshError: unknown;
}) {
  const { t } = useTranslation('admin');
  const reasonId = useId();
  const action = useAiMemberAction();
  // Polling and saves never replace what the admin is typing.
  const [draft, setDraft] = useState<AiKnowledgeDraft>(
    () => readStoredDraft(draftKey(status)) ?? draftFrom(status.settings),
  );
  const [saved, setSaved] = useState<AiKnowledgeDraft>(() => draftFrom(status.settings));
  const [localError, setLocalError] = useState<string | null>(null);
  const dirty = !same(draft, saved);
  const storeKey = draftKey(status);
  useEffect(() => {
    if (dirty) writeStoredDraft(storeKey, draft);
    else {
      writeStoredDraft(storeKey, null);
      writeStoredDraft('wati.ai-draft.new', null);
    }
  }, [dirty, draft, storeKey]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const uploading = useRef(false);
  const enabled = Boolean(status.member && !status.member.disabled);
  const pill = memberPill(status, draft);
  const ready = connectionReady(status);
  const knowledge = hasKnowledge(draft, status.documents.length);
  const canTurnOn = ready && knowledge;
  const pillLabels = {
    on: t('ai.page.pill.on'),
    off: t('ai.page.pill.off'),
    needsConnection: t('ai.page.pill.needsConnection'),
    needsKnowledge: t('ai.page.pill.needsKnowledge'),
  };
  const stateLabels: Record<AiMemberStatus['connection']['state'], string> = {
    unavailable: t('ai.state.unavailable'),
    signed_out: t('ai.state.signed_out'),
    signing_in: t('ai.state.signing_in'),
    connected: t('ai.state.connected'),
    error: t('ai.state.error'),
    expired: t('ai.state.expired'),
  };
  const connectionText =
    status.settings.mode === 'api'
      ? status.hasApiKey
        ? t('ai.keySaved')
        : t('ai.keyMissing')
      : t('ai.chatgptState', { state: stateLabels[status.connection.state] });

  /** Saves the whole page (name + knowledge) with the given on/off state. */
  const save = async (nextEnabled: boolean, done: string): Promise<AiMemberStatus | null> => {
    setLocalError(null);
    const sent = draft;
    const parsed = AiMemberBody.safeParse({ ...sent, enabled: nextEnabled });
    if (!parsed.success) {
      setLocalError(t('ai.checkSettings'));
      return null;
    }
    try {
      const next = await action.mutateAsync({ kind: 'save', settings: parsed.data });
      const stored = draftFrom(next.settings);
      setSaved(stored);
      // Adopt the stored values only if nothing was typed while saving.
      setDraft((current) => (same(current, sent) ? stored : current));
      toast.success(done);
      return next;
    } catch {
      return null; // shown from action.error
    }
  };

  const upload = async (file: File) => {
    if (uploading.current) return;
    uploading.current = true;
    try {
      await uploadFile(file);
    } finally {
      uploading.current = false;
    }
  };
  const uploadFile = async (file: File) => {
    setLocalError(null);
    if (!/\.(txt|md|pdf|docx)$/i.test(file.name)) {
      setLocalError(t('ai.fileTypeError'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setLocalError(t('ai.fileSizeError'));
      return;
    }
    // Documents belong to the AI member: the first upload saves a disabled draft member.
    if (!status.member && !(await save(false, t('ai.page.draftSaved')))) return;
    action.mutate({ kind: 'upload', file });
  };

  const reason = !ready ? t('ai.page.reasonConnection') : t('ai.page.reasonKnowledge');
  return (
    <div className="flex flex-col gap-4 pb-4">
      <nav aria-label={t('ai.page.breadcrumb')} className="flex items-center gap-1 text-sm">
        <Link
          to="/admin/members"
          className="inline-flex items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline pointer-coarse:min-h-11"
        >
          {t('nav.members')}
        </Link>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate">
          {draft.displayName.trim() || t('ai.page.defaultTitle')}
        </span>
      </nav>
      <PageHeader
        className="pb-0"
        title={draft.displayName.trim() || t('ai.page.defaultTitle')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <StatusDot tone={PILL_TONE[pill]} label={pillLabels[pill]} />
            {enabled ? (
              <Button
                variant="outline"
                size="touch"
                disabled={action.isPending}
                onClick={() => void save(false, t('ai.page.turnedOff'))}
              >
                {t('ai.page.turnOff')}
              </Button>
            ) : (
              <Button
                size="touch"
                disabled={action.isPending || !canTurnOn}
                aria-describedby={canTurnOn ? undefined : reasonId}
                onClick={() => void save(true, t('ai.page.turnedOn'))}
              >
                <Pending show={action.isPending} />
                {t('ai.page.turnOn')}
              </Button>
            )}
          </div>
        }
      />
      {!enabled && !canTurnOn && (
        <p id={reasonId} className="text-sm text-muted-foreground">
          {reason}
        </p>
      )}
      <AiConnectionBanner
        status={status}
        action={
          <Button asChild size="touch" variant="outline">
            <Link to="/admin/settings/ai">{t('ai.page.openSettings')}</Link>
          </Button>
        }
      />

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>{t('ai.page.stepName')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field label={t('ai.memberName')}>
            {(p) => (
              <Input
                {...p}
                value={draft.displayName}
                maxLength={64}
                disabled={action.isPending}
                onChange={(e) => setDraft((old) => ({ ...old, displayName: e.target.value }))}
              />
            )}
          </Field>
          <p className="text-sm text-muted-foreground">{t('ai.roleDescription')}</p>
        </CardContent>
      </Card>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>{t('ai.page.stepKnowledge')}</CardTitle>
        </CardHeader>
        <CardContent>
          <AiKnowledgeSection
            draft={draft}
            onChange={setDraft}
            documents={status.documents}
            disabled={action.isPending}
            uploadDisabled={false}
            onUpload={(file) => void upload(file)}
            onRemoveDocument={(id) => action.mutate({ kind: 'remove', id })}
          />
        </CardContent>
      </Card>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>{t('ai.page.stepTry')}</CardTitle>
        </CardHeader>
        <CardContent>
          <AiTryIt draft={draft} />
        </CardContent>
      </Card>

      <details className="rounded-lg border bg-card px-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">
          {t('ai.page.howItWorks')}
        </summary>
        <p className="pb-4 text-sm leading-relaxed text-muted-foreground">{t('ai.behavior')}</p>
      </details>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{t('ai.page.connectionLine', { state: connectionText })}</span>
        <Link
          to="/admin/settings/ai"
          className="inline-flex items-center font-medium text-primary underline-offset-4 hover:underline pointer-coarse:min-h-11"
        >
          {t('ai.page.openSettings')}
        </Link>
      </p>

      {Boolean(refreshError) && (
        <Banner tone="danger">{t('ai.refreshError', { error: errorMessage(refreshError) })}</Banner>
      )}
      {(localError || action.error) && (
        <Banner tone="danger">{localError ?? errorMessage(action.error)}</Banner>
      )}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t bg-background px-4 py-3 md:static md:mx-0 md:border-0 md:px-0">
        {dirty && <Badge variant="outline">{t('ai.unsaved')}</Badge>}
        <Button
          size="touch"
          disabled={action.isPending || (!dirty && Boolean(status.member))}
          onClick={() => void save(enabled, t('ai.memberSaved'))}
        >
          <Pending show={action.isPending} />
          {t('ai.page.save')}
        </Button>
      </div>
    </div>
  );
}
