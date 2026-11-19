/**
 * TEMPORARY mirror of the shared Live translate contract (`packages/shared/src/live-translate.ts`, design
 * `docs/features/live-translate/design.md` → "Implementation contract"). The server session lands the real schemas in
 * `@ezychat/shared`; this file is then deleted and its importers point at the package.
 */
import { z } from 'zod';
import { MeResponse, type Message } from '@ezychat/shared';

export const TRANSLATE_LANGUAGES = [
  'ms',
  'en',
  'zh',
  'id',
  'ta',
  'th',
  'vi',
  'ar',
  'ja',
  'ko',
] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];

export interface LiveTranslateSettings {
  enabled: boolean;
  dailyLimit: number;
}
export interface LiveTranslateStatus extends LiveTranslateSettings {
  connected: boolean;
  usedToday: number;
  peopleToday?: number;
  translationsToday?: number;
}
export interface ChatTranslateState {
  on: boolean;
  customerLanguage: TranslateLanguage | null;
  detected: TranslateLanguage | null;
  mixed: TranslateLanguage | null;
  outgoingLanguage: TranslateLanguage | null;
  outgoingDetected: TranslateLanguage | null;
}
export interface ChatTranslateBody {
  on?: boolean;
  customerLanguage?: TranslateLanguage | null;
  outgoingLanguage?: TranslateLanguage | null;
}
export type MessageTranslation =
  | { status: 'ok'; text: string; from: TranslateLanguage }
  | { status: 'same_language' }
  | { status: 'unsafe'; from: TranslateLanguage }
  | { status: 'limit' }
  | { status: 'ai_unavailable' }
  | { status: 'failed' };
export interface TranslationsResponse {
  translations: Record<string, MessageTranslation>;
}
export type TranslateDraft =
  | {
      status: 'ok';
      translation: string;
      from: TranslateLanguage;
      protected: string[];
      draftId: string;
    }
  | { status: 'refused'; item: string; became: string };
export interface SendTranslation {
  draftId: string;
  typedText: string;
  typedLanguage: TranslateLanguage;
  edited: boolean;
}
export interface TypedRecord {
  typedText: string;
  typedLanguage: TranslateLanguage;
  sentLanguage: TranslateLanguage;
  edited: boolean;
}
/** A message as the server will send it once `typed` and `sentOriginal` are in the shared `Message`. */
export type TranslatableMessage = Message & {
  typed?: TypedRecord | null;
  sentOriginal?: boolean;
};
/** `/api/me` fields added by Live translate. */
export interface MeTranslate {
  translateLanguage?: TranslateLanguage | null;
  sendWithoutPreview?: boolean;
}

/**
 * `/api/me` as the web reads it: the shared user plus the two Live translate fields. Until the shared `UserSchema`
 * carries them, `MeResponse.parse` would strip them.
 */
export const MeWithTranslate = MeResponse.extend({
  translateLanguage: z.enum(TRANSLATE_LANGUAGES).nullable().default(null),
  sendWithoutPreview: z.boolean().default(false),
});
