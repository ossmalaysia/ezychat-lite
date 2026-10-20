import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { ResponsiveDialog } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { MOCK_TEMPLATES, reopenWindow } from '../mock/inboxes';

/**
 * Proposed (multi-inbox, WhatsApp Business API): Meta allows free replies only within 24 hours after the
 * customer's last message. After that the composer gives way to an approved template message.
 */
export function WindowClosedBar({
  jid,
  inboxName,
  customerName,
}: Readonly<{ jid: string; inboxName: string; customerName: string }>) {
  const { t } = useTranslation('inbox');
  const [open, setOpen] = useState(false);
  return (
    <div
      className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center"
      data-testid="window-closed"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2 text-sm">
        <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p className="min-w-0">
          <span className="font-medium">{t('mockInbox.windowClosedTitle')}</span>{' '}
          <span className="text-muted-foreground">
            {t('mockInbox.windowClosedBody', { inbox: inboxName })}
          </span>
        </p>
      </div>
      <Button type="button" size="touch" className="sm:min-h-9" onClick={() => setOpen(true)}>
        <FileText aria-hidden />
        {t('mockInbox.sendTemplate')}
      </Button>
      <TemplateDialog
        open={open}
        customerName={customerName}
        onClose={() => setOpen(false)}
        onSent={() => {
          setOpen(false);
          toast.success(t('mockInbox.templateSent'));
          // Demo only: the customer "replies", which opens the window again.
          setTimeout(() => reopenWindow(jid), 1500);
        }}
      />
    </div>
  );
}

function TemplateDialog({
  open,
  customerName,
  onClose,
  onSent,
}: Readonly<{ open: boolean; customerName: string; onClose: () => void; onSent: () => void }>) {
  const { t } = useTranslation(['inbox', 'common']);
  const [picked, setPicked] = useState<string>(MOCK_TEMPLATES[0].name);
  const template = MOCK_TEMPLATES.find((x) => x.name === picked) ?? MOCK_TEMPLATES[0];
  const [values, setValues] = useState<string[]>([customerName, 'Kopi Apong']);
  const preview = template.body.replace(
    /\{\{(\d+)\}\}/g,
    (_, n: string) => values[Number(n) - 1] || `{{${n}}}`,
  );
  const complete = template.params.every((_, i) => (values[i] ?? '').trim() !== '');
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('mockInbox.templateTitle')}
      description={t('mockInbox.templateDescription')}
      size="medium"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="sm:min-h-9"
            onClick={onClose}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="button"
            size="touch"
            className="sm:min-h-9"
            disabled={!complete}
            onClick={onSent}
          >
            {t('mockInbox.templateSend')}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4 pb-1">
        <div
          role="radiogroup"
          aria-label={t('mockInbox.templateList')}
          className="flex flex-col gap-2"
        >
          {MOCK_TEMPLATES.map((x) => (
            <Button
              key={x.name}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={x.name === picked}
              onClick={() => {
                setPicked(x.name);
                setValues([customerName, x.name === 'order_follow_up' ? 'Kopi Apong' : '']);
              }}
              className={cn(
                'h-auto min-h-11 flex-col items-start gap-0.5 py-2 text-left whitespace-normal',
                x.name === picked && 'border-primary bg-primary/5',
              )}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {x.name} · {x.language}
              </span>
              <span className="text-sm font-normal [overflow-wrap:anywhere]">{x.body}</span>
            </Button>
          ))}
        </div>
        {template.params.map((param, i) => (
          <div key={`${template.name}-${param}`} className="flex flex-col gap-2">
            <Label htmlFor={`tpl-${i}`}>{`{{${i + 1}}} ${param}`}</Label>
            <Input
              id={`tpl-${i}`}
              value={values[i] ?? ''}
              onChange={(e) => setValues((v) => Object.assign([...v], { [i]: e.target.value }))}
            />
          </div>
        ))}
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {t('mockInbox.templatePreview')}
          </p>
          <p className="[overflow-wrap:anywhere]" data-testid="template-preview">
            {preview}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{t('mockInbox.templateCost')}</p>
      </div>
    </ResponsiveDialog>
  );
}
