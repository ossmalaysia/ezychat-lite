import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Proposed (app-navigation): the phone app bar of a page reached from the bottom tabs. A tab's own page has only
 * its title; a page one level down (Members, Quick replies, …) has a back link to the page it came from.
 */
export function PhoneBar({ title, back }: { title: string; back?: { to: string; label: string } }) {
  return (
    <header className="safe-top shrink-0 border-b bg-surface md:hidden" data-testid="phone-bar">
      <div className="flex min-h-14 items-center gap-1 px-1">
        {back ? (
          <Button asChild variant="ghost" size="icon-touch" className="text-primary">
            <Link to={back.to} aria-label={back.label} title={back.label}>
              <ChevronLeft className="size-6" aria-hidden />
            </Link>
          </Button>
        ) : (
          <span className="w-3" aria-hidden />
        )}
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">{title}</h1>
      </div>
    </header>
  );
}
