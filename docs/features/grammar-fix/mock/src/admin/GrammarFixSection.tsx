import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { SegmentedControl } from '@/components/app/SegmentedControl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  grammarKey,
  useGrammarState,
  type GrammarState,
  type MockGrammarInstall,
  type MockGrammarMode,
} from '@/mock/grammar';
import { SaveBar } from './adminUi';

/**
 * Proposed (grammar-fix): Settings → AI card with the team-wide Fix English switch. On by default
 * on a new install with an AI connection, off after an update; disabled without a connection. It
 * uses the "Model for suggestions" of the Reply suggestions card. The dashed "Mock only" box
 * switches the mock's install kind and AI behaviour to show every state.
 */
export function GrammarFixSection() {
  const { t } = useTranslation('admin');
  const client = useQueryClient();
  const query = useGrammarState();
  const [draft, setDraft] = useState<boolean>();
  const enabled = draft ?? query.data?.enabled ?? false;
  const dirty = draft !== undefined && draft !== query.data?.enabled;
  const connected = query.data?.connected ?? false;
  const installId = useId();
  const modeId = useId();
  const save = useMutation({
    mutationFn: (body: {
      enabled?: boolean;
      mode?: MockGrammarMode;
      install?: MockGrammarInstall;
    }) => api<GrammarState>('/mock/grammar', { method: 'PUT', body }),
    onSuccess: (data) => {
      client.setQueryData(grammarKey, data);
      setDraft(undefined);
    },
  });
  return (
    <Card data-testid="grammar-settings">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{t('mockGrammar.title')}</CardTitle>
          <Badge variant="outline">{t('mockSuggest.proposed')}</Badge>
        </div>
        <CardDescription>{t('mockGrammar.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {query.data?.install === 'upgraded' && !query.data.enabled && connected && (
          <Banner tone="info">{t('mockGrammar.upgraded')}</Banner>
        )}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="grammar-enabled">{t('mockGrammar.enable')}</Label>
            <p className="mt-1 text-sm text-muted-foreground">{t('mockGrammar.cost')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('mockGrammar.rules')}</p>
          </div>
          <Label
            htmlFor="grammar-enabled"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          >
            <Switch
              id="grammar-enabled"
              checked={enabled && connected}
              onCheckedChange={setDraft}
              disabled={query.isPending || !connected}
            />
          </Label>
        </div>
        {query.data && !connected && (
          <Banner tone="warning">{t('mockGrammar.noConnection')}</Banner>
        )}
        {(save.error || query.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error)}</Banner>
        )}
        <SaveBar dirty={dirty}>
          <Button
            size="touch"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ enabled })}
          >
            {t('settings.save')}
          </Button>
        </SaveBar>
        <div
          className="flex flex-col gap-3 rounded-lg border border-dashed px-3 py-3"
          data-testid="mock-grammar-controls"
        >
          <Badge variant="outline" className="self-start">
            {t('mockSuggest.mockControls')}
          </Badge>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span id={installId} className="text-sm font-medium">
              {t('mockSuggest.install')}
            </span>
            <SegmentedControl<MockGrammarInstall>
              size="sm"
              aria-labelledby={installId}
              value={query.data?.install ?? 'new'}
              onValueChange={(install) => save.mutate({ install })}
              options={[
                { value: 'new', label: t('mockSuggest.installNew') },
                { value: 'upgraded', label: t('mockSuggest.installUpgraded') },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span id={modeId} className="text-sm font-medium">
              {t('mockSuggest.mode')}
            </span>
            <SegmentedControl<MockGrammarMode>
              size="sm"
              aria-labelledby={modeId}
              value={query.data?.mode ?? 'normal'}
              onValueChange={(mode) => save.mutate({ mode })}
              options={[
                { value: 'normal', label: t('mockSuggest.modeNormal') },
                { value: 'slow', label: t('mockSuggest.modeSlow') },
                { value: 'error', label: t('mockSuggest.modeError') },
                { value: 'expired', label: t('mockSuggest.modeExpired') },
              ]}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
