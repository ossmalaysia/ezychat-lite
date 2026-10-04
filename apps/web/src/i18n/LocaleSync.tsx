import { useEffect } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { localeStore } from './locale-store';

/** Applies the signed-in user's saved language (it follows them across browsers and devices). */
export function LocaleSync() {
  const { user } = useAuth();
  const saved = user?.locale ?? null;
  useEffect(() => {
    if (saved && saved !== localeStore.getSnapshot()) void localeStore.setLocale(saved);
  }, [saved]);
  return null;
}
