import { describe, expect, it } from 'vitest';
import { customerWrote, eventDescription, resolveContact } from './contact.js';

const saved = { name: 'Mei Ying', email: null, phone: '60123456789' };

describe('customerWrote', () => {
  it('finds names and emails in any case and spacing, phones by their digits', () => {
    const texts = [
      'My email is Mei.Ying@Example.com',
      'call  me:  +60 12-888 7777',
      'I am  Mei   Ying',
    ];
    expect(customerWrote(texts, 'email', 'mei.ying@example.com')).toBe(true);
    expect(customerWrote(texts, 'name', 'mei ying')).toBe(true);
    // the local form of the number the customer wrote with the country code
    expect(customerWrote(texts, 'phone', '012-888 7777')).toBe(true);
    expect(customerWrote(texts, 'phone', '012-999 7777')).toBe(false);
    expect(customerWrote(texts, 'phone', '+6012 8887777')).toBe(true);
    expect(customerWrote(texts, 'email', 'other@example.com')).toBe(false);
    // too short to be a phone number, and empty values never match
    expect(customerWrote(texts, 'phone', '7777')).toBe(false);
    expect(customerWrote(texts, 'name', '  ')).toBe(false);
  });
});

describe('resolveContact', () => {
  it('uses the saved contact and lists what the AI must ask for', () => {
    expect(resolveContact(saved, {}, [])).toEqual({
      ok: false,
      reason: 'missing_details',
      missing: ['email'],
    });
    expect(resolveContact({ name: null, email: null, phone: null }, {}, [])).toEqual({
      ok: false,
      reason: 'missing_details',
      missing: ['name', 'email', 'phone'],
    });
    expect(resolveContact({ ...saved, email: 'mei@example.com' }, {}, [])).toEqual({
      ok: true,
      contact: { name: 'Mei Ying', email: 'mei@example.com', phone: '60123456789' },
    });
  });

  it('takes what the customer wrote over the saved contact, phones as digits', () => {
    const texts = ['Book it for Ahmad, ahmad@example.com, 016-222 3333'];
    expect(
      resolveContact(
        saved,
        { name: 'Ahmad', email: 'ahmad@example.com', phone: '016-222 3333' },
        texts,
      ),
    ).toEqual({
      ok: true,
      contact: { name: 'Ahmad', email: 'ahmad@example.com', phone: '0162223333' },
    });
  });

  it('refuses a detail the customer never wrote, and an invalid email', () => {
    expect(resolveContact(saved, { email: 'made.up@example.com' }, ['ok book it'])).toEqual({
      ok: false,
      reason: 'not_from_customer',
      field: 'email',
    });
    expect(resolveContact(saved, { email: 'mei at example' }, ['mei at example'])).toEqual({
      ok: false,
      reason: 'invalid_email',
    });
  });
});

describe('eventDescription', () => {
  it('lists name, phone and email, and the WhatsApp number only when it differs', () => {
    const contact = { name: 'Mei Ying', email: 'mei@example.com', phone: '60123456789' };
    expect(eventDescription(contact, '60123456789')).toBe(
      'Booked by the EzyChat AI\nName: Mei Ying\nPhone: +60123456789\nEmail: mei@example.com',
    );
    expect(eventDescription({ ...contact, phone: '0162223333' }, '60123456789')).toBe(
      'Booked by the EzyChat AI\nName: Mei Ying\nPhone: +0162223333\nEmail: mei@example.com\nWhatsApp: +60123456789',
    );
  });
});
