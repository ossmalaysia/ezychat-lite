import { z } from 'zod';

/**
 * Who a booking is for: name, email and phone. Each comes from the saved contact (customer profile,
 * the WhatsApp name and number) when it is there; the AI asks the customer for the rest and passes
 * what they wrote. A detail the AI passes must appear in the customer's own messages of this chat,
 * so the AI can never invent an email or a phone number.
 */
export const CONTACT_FIELDS = ['name', 'email', 'phone'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export type BookingContact = Record<ContactField, string | null>;

export type ContactResult =
  | { ok: true; contact: { name: string; email: string; phone: string } }
  | { ok: false; reason: 'missing_details'; missing: ContactField[] }
  | { ok: false; reason: 'not_from_customer'; field: ContactField }
  | { ok: false; reason: 'invalid_email' };

const words = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const digits = (text: string) => text.replace(/\D/g, '');
const isEmail = (text: string) => z.string().email().max(254).safeParse(text).success;

/** True when the customer wrote `value` in one of `texts` (their own messages). */
export function customerWrote(
  texts: readonly string[],
  field: ContactField,
  value: string,
): boolean {
  if (field === 'phone') {
    const number = digits(value);
    return number.length >= 7 && texts.some((text) => digits(text).includes(number));
  }
  const needle = words(value);
  return needle.length > 0 && texts.some((text) => words(text).includes(needle));
}

/**
 * The contact the event gets: what the AI passed (checked against the customer's messages) over the
 * saved contact. Fails with the missing fields so the AI asks for them, without booking.
 */
export function resolveContact(
  saved: BookingContact,
  given: Partial<Record<ContactField, string | undefined>>,
  texts: readonly string[],
): ContactResult {
  const contact: BookingContact = { ...saved };
  for (const field of CONTACT_FIELDS) {
    const value = given[field]?.trim();
    if (!value) continue;
    if (!customerWrote(texts, field, value))
      return { ok: false, reason: 'not_from_customer', field };
    contact[field] = field === 'phone' ? digits(value) : value;
  }
  const missing = CONTACT_FIELDS.filter((field) => !contact[field]?.trim());
  if (missing.length) return { ok: false, reason: 'missing_details', missing };
  if (!isEmail(contact.email!)) return { ok: false, reason: 'invalid_email' };
  return {
    ok: true,
    contact: { name: contact.name!.trim(), email: contact.email!.trim(), phone: contact.phone! },
  };
}

/** The event description: who booked it and how to reach the customer (never chat text). */
export function eventDescription(
  contact: { name: string; email: string; phone: string },
  whatsapp: string | null,
): string {
  return [
    'Booked by the EzyChat AI',
    `Name: ${contact.name}`,
    `Phone: +${contact.phone}`,
    `Email: ${contact.email}`,
    whatsapp && whatsapp !== contact.phone ? `WhatsApp: +${whatsapp}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
