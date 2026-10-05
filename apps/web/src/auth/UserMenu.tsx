import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bug, Info, KeyRound, LogOut, Monitor, Moon, Settings, Share2, Sun } from 'lucide-react';
import { isLocale, SUPPORTED_LOCALES } from '@wa-team-inbox/shared';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AboutDialog, SegmentedControl } from '@/components/app';
import { FeatureRequestAction } from '@/components/app/FeatureRequestAction';
import { ShareAppAction } from '@/components/app/ShareAppAction';
import { GITHUB_ISSUES_URL } from '@/lib/links';
import { initials } from '@/lib/format';
import { useAppVersion } from '@/lib/version';
import { THEME_OPTIONS, useTheme } from '@/lib/theme';
import { useChangeLocale } from '@/i18n/use-change-locale';
import { PushToggle } from '../pwa/PushToggle';
import { useAuth } from './AuthProvider';

/**
 * Account menu: display name, appearance, language, push-notification toggle, Admin link
 * (admins only), change password and sign out. The English accessible names ("Account menu",
 * "Admin settings", "Sign out") are relied on by e2e tests, which run in English.
 */
/** Short button text for the language switch (endonyms/codes, not translated). */
const SHORT_LOCALE: Record<string, string> = { en: 'EN', ms: 'BM', 'zh-CN': '中文' };
function shortLocaleLabel(code: string, nativeName: string): string {
  return SHORT_LOCALE[code] ?? nativeName;
}

export function UserMenu({
  className,
  align = 'end',
}: {
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  const { user, isAdmin, logout } = useAuth();
  const version = useAppVersion();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const { locale, changeLocale } = useChangeLocale();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-touch"
            aria-label={t('account.menu')}
            className={cn('rounded-full', className)}
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                {initials(user.displayName)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-64 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-semibold">{user.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">
              @{user.username} · {t(`roles.${user.role}`)}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* One compact row each; arrow keys belong to the switch, not to menu navigation. */}
          <div
            className="flex flex-col gap-2 px-2 py-1.5"
            onKeyDown={(e) => {
              if (e.key.startsWith('Arrow')) e.stopPropagation();
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span id="account-appearance-label" className="text-sm font-medium">
                {t('theme.label')}
              </span>
              <SegmentedControl
                aria-labelledby="account-appearance-label"
                value={theme}
                onValueChange={setTheme}
                options={THEME_OPTIONS.map((option) => {
                  const Icon =
                    option.value === 'light' ? Sun : option.value === 'dark' ? Moon : Monitor;
                  return {
                    value: option.value,
                    label: (
                      <span title={t(option.labelKey)}>
                        <Icon aria-hidden="true" className="size-4" />
                        <span className="sr-only">{t(option.labelKey)}</span>
                      </span>
                    ),
                  };
                })}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span id="account-language-label" className="text-sm font-medium">
                {t('language.label')}
              </span>
              <SegmentedControl
                aria-labelledby="account-language-label"
                value={locale}
                onValueChange={(v) => isLocale(v) && changeLocale(v)}
                options={SUPPORTED_LOCALES.map((l) => ({
                  value: l.code,
                  label: (
                    <span lang={l.code} title={l.nativeName}>
                      <span aria-hidden="true">{shortLocaleLabel(l.code, l.nativeName)}</span>
                      <span className="sr-only">{l.nativeName}</span>
                    </span>
                  ),
                }))}
              />
            </div>
          </div>
          <DropdownMenuSeparator />
          <PushToggle compact className="px-2" />
          <DropdownMenuSeparator />
          {isAdmin && (
            <DropdownMenuItem asChild className="min-h-11">
              <Link to="/admin">
                <Settings aria-hidden="true" />
                {t('account.adminSettings')}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild className="min-h-11">
            <Link to="/change-password">
              <KeyRound aria-hidden="true" />
              {t('account.changePassword')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11" onSelect={() => setShareOpen(true)}>
            <Share2 aria-hidden="true" />
            {t('account.share')}
          </DropdownMenuItem>
          <FeatureRequestAction placement="menu" />
          <DropdownMenuItem asChild className="min-h-11">
            <a href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer">
              <Bug aria-hidden="true" />
              {t('account.reportIssue')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11" onSelect={() => setAboutOpen(true)}>
            <Info aria-hidden="true" />
            {t('account.about', { appName: t('appName') })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="min-h-11"
            onSelect={() => {
              void logout();
            }}
          >
            <LogOut aria-hidden="true" />
            {t('account.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} version={version ?? undefined} />
      <ShareAppAction open={shareOpen} onOpenChange={setShareOpen} />
    </>
  );
}

export default UserMenu;
