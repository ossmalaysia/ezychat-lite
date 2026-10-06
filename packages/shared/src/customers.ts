import { z } from 'zod';

export const CUSTOMER_TAG_LIMIT = 10;
export const CUSTOMER_TAG_MAX_CHARS = 30;
// Deliberately simple: one @, something on both sides, a dot in the domain, no spaces.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+\-() ]*$/;

/** Trim and collapse inner whitespace: the display spelling of a tag. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ');
}
/** Case-insensitive identity of a tag ("VIP" = "vip"). */
export function customerTagKey(tag: string): string {
  return normalizeTag(tag).toLowerCase();
}

const text = (max: number) => z.string().trim().max(max).default('');

/** PUT body: the whole profile. Empty strings mean "not set". */
export const CustomerProfileBody = z.object({
  name: text(120),
  company: text(120),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === '' || EMAIL.test(v), { message: 'Enter a valid email address' })
    .default(''),
  otherPhone: z
    .string()
    .trim()
    .max(32)
    .refine((v) => PHONE.test(v), { message: 'Use digits, spaces, +, -, ( or )' })
    .default(''),
  address: text(300),
  tags: z
    .array(z.string().transform(normalizeTag).pipe(z.string().min(1).max(CUSTOMER_TAG_MAX_CHARS)))
    .max(CUSTOMER_TAG_LIMIT)
    .default([]),
});
export type CustomerProfileBody = z.infer<typeof CustomerProfileBody>;

export const CustomerProfileSchema = z.object({
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
