// App navigation (docs/features/app-navigation/design.md): the account menu as a page, for phones (the Account tab
// of a team member, the "Your account" row of an admin's Settings). Desktop keeps the account menu under the photo
// at the bottom of the rail; the page works there too.
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  ExternalLink,
  Info,
  KeyRound,
  LogOut,
  Mail,
  MessageSquarePlus,
  Share2,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { isLocale, SUPPORTED_LOCALES } from '@ezychat/shared';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AboutDialog, PageHeader, SegmentedControl } from '@/components/app';
import { openFeedback } from '@/components/app/FeedbackDialog';
import { ShareAppAction } from '@/components/app/ShareAppAction';
import { useAppLinks } from '@/lib/app-links';
import { initials } from '@/lib/format';
import { useAppVersion } from '@/lib/version';
import { THEME_OPTIONS, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useChangeLocale } from '@/i18n/use-change-locale';
import { PushToggle } from '../pwa/PushToggle';
import { useAuth } from '../auth/AuthProvider';
import { PhoneBar } from './PhoneBar';

/** Short button text for the language switch (endonyms/codes, not translated), as in the account menu. */
const SHORT_LOCALE: Record<string, string> = { en: 'EN', ms: 'BM', 'zh-CN': '中文' };

const rowClass =
  'flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset';
const buttonRowClass = cn(
  rowClass,
  'h-auto justify-start rounded-none font-normal has-[>svg]:px-4',
);

function RowContent({
  icon: Icon,
  label,
  trailing,
}: {
  icon: LucideIcon;
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <>
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
      {trailing ?? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );
}

export function AccountPage() {
  const { t } = useTranslation();
  const { user, isAdmin, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { locale, changeLocale } = useChangeLocale();
  const version = useAppVersion();
  const links = useAppLinks();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const themeId = useId();
  const langId = useId();
  if (!user) return null;

  return (
    <div className="flex h-full flex-col">
      <PhoneBar
        title={t('appNav.accountTitle')}
        back={
          isAdmin
            ? { to: '/admin', label: t('appNav.backTo', { place: t('appNav.settings') }) }
            : undefined
        }
      />
      <main className="safe-x min-h-0 flex-1 overflow-y-auto" data-testid="account-page">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 sm:py-6">
          <PageHeader
            className="max-md:hidden"
            title={t('appNav.accountTitle')}
            description={t('appNav.accountDescription')}
          />
          <section className="flex items-center gap-3 rounded-xl border bg-surface p-4">
            <Avatar className="size-12">
              <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
                {initials(user.displayName) || <UserRound className="size-[55%]" aria-hidden />}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{user.displayName}</p>
              <p className="truncate text-sm text-muted-foreground">
                @{user.username} · {t(`roles.${user.role}`)}
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-4 rounded-xl border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span id={themeId} className="text-sm font-medium">
                {t('theme.label')}
              </span>
              <SegmentedControl
                aria-labelledby={themeId}
                value={theme}
                onValueChange={(v) => setTheme(v)}
                options={THEME_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span id={langId} className="text-sm font-medium">
                {t('language.label')}
              </span>
              <SegmentedControl
                aria-labelledby={langId}
                value={locale}
                onValueChange={(v) => isLocale(v) && changeLocale(v)}
                options={SUPPORTED_LOCALES.map((l) => ({
                  value: l.code,
                  label: (
                    <span lang={l.code} title={l.nativeName}>
                      {SHORT_LOCALE[l.code] ?? l.nativeName}
                    </span>
                  ),
                }))}
              />
            </div>
            <PushToggle />
          </section>

          <section className="divide-y overflow-hidden rounded-xl border bg-surface">
            <Link to="/change-password" className={rowClass}>
              <RowContent icon={KeyRound} label={t('account.changePassword')} />
            </Link>
            {/* Admins only: agents cannot buy. Hidden when the product has no upgrade link. */}
            {isAdmin && links.upgrade && (
              <a
                href={links.upgrade}
                target="_blank"
                rel="noopener noreferrer"
                className={rowClass}
              >
                <RowContent
                  icon={Sparkles}
                  label={t('upgrade.cta')}
                  trailing={<ExternalLink className="size-4 text-muted-foreground" aria-hidden />}
                />
              </a>
            )}
            <Button variant="ghost" className={buttonRowClass} onClick={() => setShareOpen(true)}>
              <RowContent icon={Share2} label={t('account.share')} />
            </Button>
            <Button variant="ghost" className={buttonRowClass} onClick={() => openFeedback()}>
              <RowContent icon={MessageSquarePlus} label={t('account.sendFeedback')} />
            </Button>
            {/* Editions without a public issue tracker keep their support email here. */}
            {!links.reportIssue && links.supportEmail && (
              <a href={`mailto:${links.supportEmail}`} className={rowClass}>
                <RowContent icon={Mail} label={t('account.emailSupport')} />
              </a>
            )}
            <Button variant="ghost" className={buttonRowClass} onClick={() => setAboutOpen(true)}>
              <RowContent icon={Info} label={t('account.about', { appName: t('appName') })} />
            </Button>
          </section>

          <Button
            variant="outline"
            size="touch"
            className="w-full text-danger"
            onClick={() => void logout()}
            data-testid="account-sign-out"
          >
            <LogOut aria-hidden />
            {t('account.signOut')}
          </Button>
          {version && (
            <p className="text-center text-xs text-muted-foreground">
              {t('appName')} {version}
            </p>
          )}
        </div>
      </main>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} version={version ?? undefined} />
      <ShareAppAction open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  );
}

export default AccountPage;
