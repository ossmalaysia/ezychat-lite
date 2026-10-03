import { useId, useState } from 'react';
import { Copy, Download, ExternalLink, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  copyShareText,
  downloadShareCard,
  SHARE_APP_CAPTION,
  SHARE_APP_URL,
  shareApp,
  shareAppMessage,
  SOCIAL_SHARE_LINKS,
} from '@/lib/share-app';
import { ResponsiveDialog } from './index';

/** Personal recommendation tools, with user-controlled posting on each platform. */
export function ShareAppAction({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const [caption, setCaption] = useState(SHARE_APP_CAPTION);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  async function copy(text: string, success: string) {
    try {
      await copyShareText(text);
      setFeedback(success);
    } catch {
      setFeedback(
        'Copy is unavailable here. Select the message or link above and copy it manually.',
      );
    }
  }

  async function nativeShare() {
    setFeedback('');
    setBusy(true);
    try {
      const result = await shareApp(caption);
      if (result === 'copied')
        setFeedback('Message and public link copied. Paste them into your post.');
    } catch {
      setFeedback(
        'Sharing is unavailable here. Select the message or link above and copy it manually.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setFeedback('');
    setBusy(true);
    try {
      await downloadShareCard();
      setFeedback('Image download started. Upload it to Instagram and paste your caption.');
    } catch {
      setFeedback(
        'Could not prepare the image. Try downloading again, or share the message and public link.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Share this app"
      description="Tell others about your free team inbox. You choose what to post."
      footer={
        <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <div className="min-w-0 space-y-4 pb-4">
        <div className="space-y-2">
          <Label htmlFor={`${id}-caption`}>Your message</Label>
          <Textarea
            id={`${id}-caption`}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            className="max-h-48 min-h-32 resize-y [overflow-wrap:anywhere]"
            maxLength={2000}
          />
          <Button
            variant="outline"
            size="touch"
            className="w-full"
            onClick={() =>
              void copy(
                shareAppMessage(caption),
                'Message and public link copied. Paste them into your post.',
              )
            }
          >
            <Copy aria-hidden="true" /> Copy message and link
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-url`}>Public app link</Label>
          <Input
            id={`${id}-url`}
            readOnly
            value={SHARE_APP_URL}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="text-sm text-muted-foreground">
            This shares the public project page. Your private inbox address and conversations stay
            private.
          </p>
          <Button
            variant="ghost"
            size="touch"
            onClick={() => void copy(SHARE_APP_URL, 'Public app link copied.')}
          >
            <Copy aria-hidden="true" /> Copy link only
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">LinkedIn &amp; Facebook</p>
          <p className="text-sm text-muted-foreground">
            Copy your message first, then paste it into the post that opens.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(['linkedin', 'facebook'] as const).map((platform) => (
              <Button key={platform} asChild variant="outline" size="touch">
                <a href={SOCIAL_SHARE_LINKS[platform]} target="_blank" rel="noopener noreferrer">
                  {platform === 'linkedin' ? 'LinkedIn' : 'Facebook'}{' '}
                  <ExternalLink aria-hidden="true" />
                  <span className="sr-only"> (opens a new window)</span>
                </a>
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-medium">Instagram</p>
          <p className="text-sm text-muted-foreground">
            Download the image, create a post in Instagram, then paste your copied message as the
            caption. Add the public link to your bio or a story link sticker.
          </p>
          <img
            src="/share-app.svg"
            alt="WA Team Inbox: Free WhatsApp team inbox. Runs on your computer. You own your data."
            className="mx-auto aspect-square w-40 max-w-full rounded-lg border"
          />
          <Button
            variant="outline"
            size="touch"
            className="w-full"
            disabled={busy}
            onClick={() => void download()}
          >
            <Download aria-hidden="true" /> Download Instagram image
          </Button>
        </div>
        {typeof navigator.share === 'function' && (
          <Button
            size="touch"
            className="w-full"
            disabled={busy}
            onClick={() => void nativeShare()}
          >
            <Share2 aria-hidden="true" /> More sharing options
          </Button>
        )}
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          {feedback}
        </p>
      </div>
    </ResponsiveDialog>
  );
}
