import { useTranslation } from 'react-i18next';
import type { HiddenChatsInfo } from '@ezychat/shared';
import { Banner } from '@/components/app';
import { formatInboxNumber } from './inbox-status';

/**
 * Hide chats on Log out (docs/features/chat-hide-delete/design.md Part A): the texts Admin → WhatsApp
 * and Admin → Inboxes show around a Log out.
 */

/**
 * The Log out (or Link again) confirmation's line: how many chats leave the inbox. Without counts yet
 * it says so without a number; with no chat to hide it says nothing.
 */
export function HidesLine({ info }: Readonly<{ info: HiddenChatsInfo | undefined }>) {
  const { t } = useTranslation('admin');
  if (!info) return <p>{t('whatsapp.hidesUnknown')}</p>;
  if (info.visible === 0) return null;
  return <p>{t('whatsapp.hides', { count: info.visible })}</p>;
}

/** The logged-out note: the chats of the old number are hidden until that number links again. */
export function HiddenChatsNote({ info }: Readonly<{ info: HiddenChatsInfo | undefined }>) {
  const { t } = useTranslation('admin');
  if (!info || info.hidden === 0) return null;
  return (
    <Banner tone="info">
      {t('whatsapp.hiddenNote', {
        count: info.hidden,
        number: formatInboxNumber(info.number) ?? '',
      })}
    </Banner>
  );
}
