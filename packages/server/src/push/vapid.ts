import webpush from 'web-push';
import type { SettingsStore } from '../db/settings.js';

export interface VapidDetails {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export const DEFAULT_PUSH_SUBJECT = 'mailto:noreply@localhost';

/**
 * Loads the VAPID key pair, generating it once. The public key is a plain setting ('vapid_public'),
 * the private key is stored encrypted via settings.setSecret('vapid_private').
 */
export function loadOrCreateVapid(settings: SettingsStore): VapidDetails {
  let publicKey = settings.get<string | null>('vapid_public', null);
  let privateKey = settings.getSecret('vapid_private');
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    settings.setSecret('vapid_private', privateKey);
    settings.set('vapid_public', publicKey);
  }
  const subject = settings.get<string | null>('push_subject', null) || DEFAULT_PUSH_SUBJECT;
  return { publicKey, privateKey, subject };
}
