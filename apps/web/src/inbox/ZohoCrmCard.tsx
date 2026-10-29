import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../api/client';
import { useAddChatZohoLead, useChatZohoCrm } from '../api/zoho-crm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * The customer panel's Zoho CRM section, for every teammate who may open the chat: the Contact or
 * Lead with its owner and status and Open in Zoho CRM; for a number not in Zoho CRM, "Add as a
 * lead". Hidden while Zoho CRM is not connected (or not set up in this build).
 */
export function ZohoCrmCard({ jid }: Readonly<{ jid: string }>) {
  const { t } = useTranslation('inbox');
  const query = useChatZohoCrm(jid);
  const add = useAddChatZohoLead(jid);
  const data = query.data;
  if (!data || data.state === 'disconnected' || data.state === 'not_configured') return null;
  const record = data.record;
  return (
    <section
      aria-label={t('zohoCrm.title')}
      className="flex flex-col gap-2 rounded-lg border px-3 py-3"
      data-testid="customer-zoho-crm"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('zohoCrm.title')}</span>
        {record && <Badge variant="secondary">{t(`zohoCrm.module.${record.module}`)}</Badge>}
      </span>
      {data.state !== 'connected' ? (
        <p className="text-sm text-muted-foreground">{t('zohoCrm.unavailable')}</p>
      ) : record ? (
        <>
          <span className="flex min-w-0 flex-col gap-0.5 text-sm">
            <span className="font-medium [overflow-wrap:anywhere]">{record.name}</span>
            {record.company && <span className="[overflow-wrap:anywhere]">{record.company}</span>}
            {record.owner && (
              <span className="text-muted-foreground">
                {t('zohoCrm.owner', { owner: record.owner })}
              </span>
            )}
            {record.status && (
              <span className="text-muted-foreground">
                {t('zohoCrm.status', { status: record.status })}
              </span>
            )}
            {record.request && (
              <span className="text-muted-foreground [overflow-wrap:anywhere]">
                {t('zohoCrm.request', { request: record.request })}
              </span>
            )}
            {record.addedBy && (
              <span className="text-xs text-muted-foreground">
                {t(record.addedBy === 'ai' ? 'zohoCrm.addedByAi' : 'zohoCrm.addedByTeam')}
              </span>
            )}
          </span>
          {record.url && (
            <Button asChild variant="outline" size="touch" className="w-full md:min-h-9">
              <a href={record.url} target="_blank" rel="noopener noreferrer">
                {t('zohoCrm.open')}
                <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('zohoCrm.notFound')}</p>
          <Button
            variant="outline"
            size="touch"
            className="w-full md:min-h-9"
            disabled={add.isPending}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: () => toast.success(t('zohoCrm.added')),
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            {add.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <UserPlus aria-hidden />
            )}
            {t('zohoCrm.add')}
          </Button>
        </>
      )}
    </section>
  );
}
