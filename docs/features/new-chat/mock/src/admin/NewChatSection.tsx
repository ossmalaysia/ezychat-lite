import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { newChatKey, useNewChatState, type NewChatState } from '@/mock/newChat';
import { SaveBar } from './adminUi';

/**
 * Proposed (new-chat): Settings → General card. Admins can always start a chat with a new number; this
 * switch lets team members do it too (off by default). Audited with before/after.
 */
export function NewChatSection() {
  const { t } = useTranslation('admin');
  const client = useQueryClient();
  const query = useNewChatState();
  const [draft, setDraft] = useState<boolean>();
  const enabled = draft ?? query.data?.staffEnabled ?? false;
  const dirty = draft !== undefined && draft !== query.data?.staffEnabled;
  const save = useMutation({
    mutationFn: (staffEnabled: boolean) =>
      api<NewChatState>('/mock/new-chat', { method: 'PUT', body: { staffEnabled } }),
    onSuccess: (data) => {
      client.setQueryData(newChatKey, data);
      setDraft(undefined);
      toast.success(t('settings.saved'));
    },
  });
  return (
    <Card className="gap-4" data-testid="new-chat-settings">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{t('mockNewChat.title')}</CardTitle>
          <Badge variant="outline">{t('mockSuggest.proposed')}</Badge>
        </div>
        <CardDescription>{t('mockNewChat.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="new-chat-staff">{t('mockNewChat.staff')}</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {enabled ? t('mockNewChat.staffOn') : t('mockNewChat.staffOff')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t('mockNewChat.limits')}</p>
          </div>
          <Label
            htmlFor="new-chat-staff"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          >
            <Switch
              id="new-chat-staff"
              checked={enabled}
              onCheckedChange={setDraft}
              disabled={query.isPending}
            />
          </Label>
        </div>
        {(save.error || query.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error)}</Banner>
        )}
        <SaveBar dirty={dirty}>
          <Button
            size="touch"
            className="md:min-h-9"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(enabled)}
          >
            {t('settings.save')}
          </Button>
        </SaveBar>
      </CardContent>
    </Card>
  );
}
