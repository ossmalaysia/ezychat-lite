import { ExternalLink, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { GITHUB_REPO_URL } from '@/lib/links';

/** Opens the repository's feature-request draft; nothing is submitted automatically. */
export function FeatureRequestAction({ placement = 'button' }: { placement?: 'button' | 'menu' }) {
  const link = (
    <a
      href={`${GITHUB_REPO_URL}/issues/new?template=feature_request.yml`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Lightbulb aria-hidden="true" />
      Request a feature
      <ExternalLink aria-hidden="true" className="ml-auto size-3.5" />
      <span className="sr-only"> (opens GitHub in a new window)</span>
    </a>
  );

  return placement === 'menu' ? (
    <DropdownMenuItem asChild className="min-h-11">
      {link}
    </DropdownMenuItem>
  ) : (
    <Button asChild variant="ghost" className="min-h-11 text-muted-foreground">
      {link}
    </Button>
  );
}
