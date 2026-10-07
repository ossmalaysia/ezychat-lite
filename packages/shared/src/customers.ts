import { z } from 'zod';

export const CUSTOMER_TAG_LIMIT = 10;
export const CUSTOMER_TAG_MAX_CHARS = 30;
// Deliberately simple: one @, something on both sides, a dot in the domain, no spaces. `?#%&` are
// refused so a stored address can never smuggle headers (bcc, subject…) into a mailto: link.
// Domain labels exclude "." so the pattern is linear (no backtracking between labels).
const EMAIL = /^[^\s@?#%&]+@[^\s@?#%&.]+(?:\.[^\s@?#%&.]+)+$/;
const PHONE = /^[0-9+\-() ]*$/;
/** Control characters (incl. the \u001f tag separator). Line breaks are allowed only in the address. */
const CONTROL = /\p{Cc}/u;
const CONTROL_EXCEPT_LINES = /[^\P{Cc}\n\r\t]/u;
/** Format characters (bidi overrides/isolates, zero-width marks) would let a name spoof its looks. */
const INVISIBLE = /\p{Cf}/u;
const NO_CONTROL = { message: 'Remove control characters' };
const NO_INVISIBLE = { message: 'Remove invisible formatting characters' };

/** Trim and collapse inner whitespace: the display spelling of a tag. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ');
}
/** Case-insensitive identity of a tag ("VIP" = "vip"). */
export function customerTagKey(tag: string): string {
  return normalizeTag(tag).toLowerCase();
}

const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !CONTROL.test(v), NO_CONTROL);
/** Shown as a display name (list, header, push title, group label): no invisible marks either. */
const displayText = (max: number) =>
  line(max)
    .refine((v) => !INVISIBLE.test(v), NO_INVISIBLE)
    .default('');

/** PUT body: the whole profile. Empty strings mean "not set". */
export const CustomerProfileBody = z.object({
  name: displayText(120),
  company: displayText(120),
  email: line(254)
    .refine((v) => v === '' || EMAIL.test(v), { message: 'Enter a valid email address' })
    .default(''),
  otherPhone: line(32)
    .refine((v) => PHONE.test(v), { message: 'Use digits, spaces, +, -, ( or )' })
    .default(''),
  address: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !CONTROL_EXCEPT_LINES.test(v), NO_CONTROL)
    .default(''),
  tags: z
    .array(
      z
        .string()
        .refine((v) => !CONTROL.test(v) && !INVISIBLE.test(v), NO_CONTROL)
        .transform(normalizeTag)
        .pipe(z.string().min(1).max(CUSTOMER_TAG_MAX_CHARS)),
    )
    .max(CUSTOMER_TAG_LIMIT)
    .default([]),
});
export type CustomerProfileBody = z.infer<typeof CustomerProfileBody>;

export const CustomerProfileSchema = z.object({
  /** Stable customer id (survives chat merges); null until the profile is first saved. */
  id: z.string().nullable(),
  name: z.string().nullable(),
  company: z.string().nullable(),
  email: z.string().nullable(),
  otherPhone: z.string().nullable(),
  address: z.string().nullable(),
  tags: z.array(z.string()),
  /** null when the profile was never saved */
  updatedAt: z.number().nullable(),
  updatedBy: z.number().nullable(),
});
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

export const CustomerProfileResponse = z.object({
  profile: CustomerProfileSchema,
  /** The name WhatsApp/the phone gives the customer, shown under the profile name. */
  whatsappName: z.string().nullable(),
  /** Phone-number digits WhatsApp gave us (no `+`); null when hidden behind a WhatsApp ID (LID).
   *  Optional only for older servers. */
  whatsappPhone: z.string().nullable().optional(),
  /** Read-only facts from WhatsApp (never edited by the team). Optional only for older servers. */
  whatsapp: z
    .object({
      /** Name the customer set on their own WhatsApp. */
      pushName: z.string().nullable(),
      /** Name saved in the linked phone's contacts. */
      savedName: z.string().nullable(),
      /** Phone-number digits (no `+`); null when WhatsApp hides it behind a WhatsApp ID. */
      phone: z.string().nullable(),
      /** WhatsApp ID (`…@lid`); only sent to admins, null for agents or when unknown. */
      lid: z.string().nullable(),
    })
    .optional(),
});
export type CustomerProfileResponse = z.infer<typeof CustomerProfileResponse>;

export const CustomerTagsQuery = z.object({
  q: z.string().trim().max(CUSTOMER_TAG_MAX_CHARS).optional(),
});
export const CustomerTagsResponse = z.object({ tags: z.array(z.string()) });
export type CustomerTagsResponse = z.infer<typeof CustomerTagsResponse>;

/** On a group message: the sender's own customer profile name, and the chat it lives on. */
export const SenderProfileSchema = z.object({ chatJid: z.string(), name: z.string() });
export type SenderProfile = z.infer<typeof SenderProfileSchema>;
