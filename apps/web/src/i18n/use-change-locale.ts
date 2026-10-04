import { useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@wa-team-inbox/shared';
import { useSetMyLocale } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';
import { localeStore, useLocale } from './locale-store';

/** Current language plus a setter that applies it here and saves it to the account when signed in. */
export function useChangeLocale() {
  const locale = useLocale();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { mutate } = useSetMyLocale();
  const signedIn = !!user;
  const changeLocale = useCallback(
    (next: Locale) => {
      void localeStore.setLocale(next);
      if (signedIn) mutate(next, { onError: () => toast.error(t('language.saveFailed')) });
    },
    [signedIn, mutate, t],
  );
  return { locale, changeLocale };
}
