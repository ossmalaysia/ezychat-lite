import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronRight, Smartphone, Users, X } from 'lucide-react';
import { useAiMember } from '../api/ai';
import { useMe, useSettings, useTunnel, useUsers } from '../api/queries';
import { memberPill } from '../admin/ai-status';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Per-browser memory of the × on the card. Storage can be blocked, so every access is guarded. */
export const GETTING_STARTED_HIDDEN_KEY = 'ezychat.getting-started-hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(GETTING_STARTED_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * A small "Getting started" card on the empty inbox, for admins only. Lists what is left
 * (AI assistant, teammates, phone access), links each to its admin page and hides finished items;
 * the whole card disappears once everything is done or the admin dismisses it.
 */
export function GettingStartedCard({ className }: { className?: string }) {
  const me = useMe();
  const [hidden, setHidden] = useState(readHidden);
  if (hidden || me.data?.role !== 'admin') return null;

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(GETTING_STARTED_HIDDEN_KEY, '1');
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
  };
  return <AdminChecklist className={className} onHide={hide} />;
}

function AdminChecklist({ className, onHide }: { className?: string; onHide: () => void }) {
  const { t } = useTranslation('inbox');
  const ai = useAiMember();
  const users = useUsers();
  const tunnel = useTunnel();
  const settings = useSettings();
  const titleId = useId();
  if (!ai.data || !users.data || !tunnel.data || !settings.data) return null;

  const humans = users.data.filter((user) => user.kind !== 'ai' && !user.disabled);
  const phoneDone =
    tunnel.data.state === 'running' ||
    settings.data.hasTunnelToken ||
    Boolean(settings.data.namedTunnelHostname);
  const items = [
    {
      key: 'ai',
      done: memberPill(ai.data) === 'on',
      icon: Bot,
      title: t('gettingStarted.ai'),
      hint: t('gettingStarted.aiHint'),
      action: t('gettingStarted.setUp'),
      to: '/admin/members/ai',
    },
    {
      key: 'team',
      done: humans.length > 1,
      icon: Users,
      title: t('gettingStarted.teammates'),
      hint: t('gettingStarted.teammatesHint'),
      action: t('gettingStarted.add'),
      to: '/admin/members',
    },
    {
      key: 'phone',
      done: phoneDone,
      icon: Smartphone,
      title: t('gettingStarted.phone'),
      hint: t('gettingStarted.phoneHint'),
      action: t('gettingStarted.setUp'),
      to: '/admin/tunnel',
    },
  ].filter((item) => !item.done);
  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby={titleId}
      className={cn('w-full max-w-md rounded-lg border bg-card text-left shadow-xs', className)}
    >
      <div className="flex items-center gap-2 border-b py-1 pr-1 pl-4">
        <h2 id={titleId} className="text-sm font-semibold whitespace-nowrap">
          {t('gettingStarted.title')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          className="ml-auto text-muted-foreground"
          aria-label={t('gettingStarted.hide')}
          title={t('gettingStarted.hide')}
          onClick={onHide}
        >
          <X aria-hidden />
        </Button>
      </div>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              to={item.to}
              className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <item.icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="block text-sm text-muted-foreground">{item.hint}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary">
                {item.action}
                <ChevronRight className="size-4" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
