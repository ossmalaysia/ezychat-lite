import { Link } from 'react-router-dom';
import { KeyRound, LogOut, Settings } from 'lucide-react';
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
  if (!user) return null;

  return (
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
  );
}

export default UserMenu;
