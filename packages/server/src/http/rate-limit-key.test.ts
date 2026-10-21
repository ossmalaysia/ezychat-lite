import { describe, expect, it } from 'vitest';
import { rateLimitKey } from './rate-limit-key.js';

describe('rateLimitKey', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('treats an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(rateLimitKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('counts every IPv6 address of one /64 network as one client', () => {
    const key = '2001:db8:1234:5678::/64';
    expect(rateLimitKey('2001:db8:1234:5678::1')).toBe(key);
    expect(rateLimitKey('2001:db8:1234:5678:ffff:ffff:ffff:ffff')).toBe(key);
    expect(rateLimitKey('2001:0DB8:1234:5678:0:0:0:abcd')).toBe(key);
    expect(rateLimitKey('2001:db8:1234:5678:a:b:c:d%eth0')).toBe(key);
    expect(rateLimitKey('2001:db8:1234:5679::1')).toBe('2001:db8:1234:5679::/64');
  });

  it('expands compressed and IPv4-tailed IPv6 forms', () => {
    expect(rateLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitKey('64:ff9b::192.0.2.33')).toBe('64:ff9b:0:0::/64');
  });

  it('leaves a value that is not an IP address unchanged', () => {
    expect(rateLimitKey('unknown')).toBe('unknown');
    expect(rateLimitKey('')).toBe('');
  });
});
