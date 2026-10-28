import { useTranslation } from 'react-i18next';
import { ExternalLink, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAddChatLead, useChatCrmRecord } from '@/mock/zohoCrm';

/**
 * Proposed (zoho-crm): the customer panel's Zoho CRM section for every teammate who can open the
 * chat. Shows the Contact or Lead with its owner and status and Open in Zoho CRM; for a number that
 * is not in Zoho CRM, "Add as a lead" (name from the saved contact or the WhatsApp name). Hidden
 * while Zoho CRM is not connected.
 */
export function ZohoCrmCard({ jid }: Readonly<{ jid: string }>) {
  const { t } = useTranslation('inbox');
  const query = useChatCrmRecord(jid);
  const add = useAddChatLead(jid);
  const data = query.data;
  if (!data || data.state === 'disconnected') return null;
  const record = data.record;
  return (
    <section
      aria-label={t('mockZohoPanel.title')}
      className="mt-4 flex flex-col gap-2 rounded-lg border px-3 py-3"
      data-testid="customer-zoho-crm"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('mockZohoPanel.title')}</span>
        {record && <Badge variant="secondary">{t(`mockZohoPanel.${record.module}`)}</Badge>}
      </span>
      {data.state !== 'connected' ? (
        <p className="text-sm text-muted-foreground">{t('mockZohoPanel.unavailable')}</p>
      ) : record ? (
        <>
          <span className="flex min-w-0 flex-col gap-0.5 text-sm">
            <span className="font-medium [overflow-wrap:anywhere]">{record.name}</span>
            {record.company && <span className="[overflow-wrap:anywhere]">{record.company}</span>}
            <span className="text-muted-foreground">
              {t('mockZohoPanel.owner', { owner: record.owner })}
            </span>
            {record.status && (
              <span className="text-muted-foreground">
                {t('mockZohoPanel.status', { status: record.status })}
              </span>
            )}
            {record.request && (
              <span className="text-muted-foreground [overflow-wrap:anywhere]">
                {t('mockZohoPanel.request', { request: record.request })}
              </span>
            )}
            {record.addedBy && (
              <span className="text-xs text-muted-foreground">
                {t(
                  record.addedBy === 'ai' ? 'mockZohoPanel.addedByAi' : 'mockZohoPanel.addedByTeam',
                )}
              </span>
            )}
          </span>
          <Button asChild variant="outline" size="touch" className="w-full md:min-h-9">
            <a href={record.url} target="_blank" rel="noopener noreferrer">
              {t('mockZohoPanel.open')}
              <ExternalLink aria-hidden />
            </a>
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('mockZohoPanel.notFound')}</p>
          <Button
            variant="outline"
            size="touch"
            className="w-full md:min-h-9"
            disabled={add.isPending}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: () => toast.success(t('mockZohoPanel.added')),
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            <UserPlus aria-hidden />
            {t('mockZohoPanel.add')}
          </Button>
        </>
      )}
    </section>
  );
}
