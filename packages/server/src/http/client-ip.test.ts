import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { clientIp, isLoopback, isHttps } from './client-ip.js';

function req(remote: string, headers: Record<string, string> = {}, protocol = 'http'): FastifyRequest {
  return {
    socket: { remoteAddress: remote },
    raw: { socket: { remoteAddress: remote } },
    headers,
    protocol,
  } as unknown as FastifyRequest;
}

describe('client-ip', () => {
  it('isLoopback', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('10.0.0.5')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
  it('ignores spoofed cf-connecting-ip from non-loopback peer', () => {
    expect(clientIp(req('10.0.0.5', { 'cf-connecting-ip': '1.2.3.4' }))).toBe('10.0.0.5');
  });
  it('honors cf-connecting-ip from loopback peer', () => {
    expect(clientIp(req('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' }))).toBe('1.2.3.4');
  });
  it('falls back to socket address', () => {
    expect(clientIp(req('127.0.0.1'))).toBe('127.0.0.1');
  });
  it('isHttps', () => {
    expect(isHttps(req('127.0.0.1', { 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(isHttps(req('10.0.0.5', { 'x-forwarded-proto': 'https' }))).toBe(false);
    expect(isHttps(req('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' }))).toBe(true);
    expect(isHttps(req('10.0.0.5', {}, 'https'))).toBe(true);
    expect(isHttps(req('127.0.0.1'))).toBe(false);
  });
});
