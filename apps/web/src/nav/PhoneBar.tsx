import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The phone app bar of a page reached from the bottom tabs (docs/features/app-navigation/design.md). A tab's own
 * page has only its title; a page one level down (Members, Quick replies, …) has a back link to where it came from.
 * `heading`: the title is the page's `h1` (a page with no title of its own, e.g. the Settings list); otherwise it
 * repeats the page's own heading and stays plain text, so a page never has two `h1`s.
 */
export function PhoneBar({
  title,
  back,
  heading = false,
}: {
  title: string;
  back?: { to: string; label: string };
  heading?: boolean;
}) {
  const Title = heading ? 'h1' : 'p';
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
        <Title
          className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight"
          data-testid="phone-bar-title"
        >
          {title}
        </Title>
      </div>
    </header>
  );
}
