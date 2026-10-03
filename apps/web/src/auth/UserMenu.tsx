import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bug, Info, KeyRound, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AboutDialog } from '@/components/app';
import { FeatureRequestAction } from '@/components/app/FeatureRequestAction';
import { GITHUB_ISSUES_URL } from '@/lib/links';
import { useAppVersion } from '@/lib/version';
import { THEME_OPTIONS, useTheme } from '@/lib/theme';
import { PushToggle } from '../pwa/PushToggle';
import { useAuth } from './AuthProvider';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Account menu: display name, push-notification toggle, Admin link (admins only),
 * change password and sign out. Accessible names ("Account menu", "Admin settings",
 * "Sign out") are relied on by e2e tests.
 */
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
  const [aboutOpen, setAboutOpen] = useState(false);
  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-touch"
            aria-label="Account menu"
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
              @{user.username} · {user.role}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel id="account-appearance-label">Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            aria-labelledby="account-appearance-label"
            value={theme}
            onValueChange={setTheme}
          >
            {THEME_OPTIONS.map((option) => {
              const Icon =
                option.value === 'light' ? Sun : option.value === 'dark' ? Moon : Monitor;
              return (
                <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-11">
                  <Icon aria-hidden="true" />
                  {option.label}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <PushToggle compact className="px-2" />
          <DropdownMenuSeparator />
          {isAdmin && (
            <DropdownMenuItem asChild className="min-h-11">
              <Link to="/admin">
                <Settings aria-hidden="true" />
                Admin settings
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild className="min-h-11">
            <Link to="/change-password">
              <KeyRound aria-hidden="true" />
              Change password
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <FeatureRequestAction placement="menu" />
          <DropdownMenuItem asChild className="min-h-11">
            <a href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer">
              <Bug aria-hidden="true" />
              Report an issue
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11" onSelect={() => setAboutOpen(true)}>
            <Info aria-hidden="true" />
            About WA Team Inbox
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
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} version={version ?? undefined} />
    </>
  );
}

export default UserMenu;
