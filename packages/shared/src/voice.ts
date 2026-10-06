import { z } from 'zod';

/**
 * Voice note transcription engine (Settings → AI → Voice messages):
 * `local` = Whisper small on this computer (downloaded model), `cloud` = OpenAI
 * `gpt-4o-transcribe` with the saved API key (API-key mode only).
 */
export const VoiceTranscription = z.enum(['off', 'local', 'cloud']);
export type VoiceTranscription = z.infer<typeof VoiceTranscription>;

/** Total bytes of the pinned Whisper small int8 model files (encoder, decoder, tokens). */
export const VOICE_MODEL_BYTES = 112_442_483 + 262_226_114 + 816_730;

/** Why the last model download failed (the web translates these codes). */
export const VoiceModelError = z.enum([
  'disk_space',
  'network',
  'verification',
  'redirect',
  'write',
  'unknown',
]);
export type VoiceModelError = z.infer<typeof VoiceModelError>;

export const VoiceModelStatus = z.object({
  state: z.enum(['not_installed', 'downloading', 'installed', 'error']),
  /** Download progress over all model files (0 unless downloading). */
  receivedBytes: z.number(),
  totalBytes: z.number(),
  error: VoiceModelError.nullable(),
});
export type VoiceModelStatus = z.infer<typeof VoiceModelStatus>;

export const VoiceStatus = z.object({
  /** The saved choice. */
  transcription: VoiceTranscription,
  model: VoiceModelStatus,
  /** Cloud transcription needs API-key mode with a saved OpenAI API key. */
  cloudAvailable: z.boolean(),
});
export type VoiceStatus = z.infer<typeof VoiceStatus>;

export const VoiceSettingBody = z.object({ transcription: VoiceTranscription });
export type VoiceSettingBody = z.infer<typeof VoiceSettingBody>;
