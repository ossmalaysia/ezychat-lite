import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  clientIp,
  isDirectLoopback,
  isLoopback,
  isHttps,
  isTrustedTunnelPeer,
} from './client-ip.js';

function req(
  remote: string,
  headers: Record<string, string> = {},
  protocol = 'http',
): FastifyRequest {
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
  it('requires one valid IP and a loopback peer for unknown tunnel hosts', () => {
    expect(isTrustedTunnelPeer('127.0.0.1', '203.0.113.9')).toBe(true);
    expect(isTrustedTunnelPeer('::1', '2001:db8::1')).toBe(true);
    for (const value of [
      undefined,
      '',
      'not-an-ip',
      '203.0.113.9, 203.0.113.10',
      ['203.0.113.9'],
    ]) {
      expect(isTrustedTunnelPeer('127.0.0.1', value)).toBe(false);
    }
    expect(isTrustedTunnelPeer('10.0.0.5', '203.0.113.9')).toBe(false);
    expect(clientIp(req('127.0.0.1', { 'cf-connecting-ip': 'not-an-ip' }))).toBe('127.0.0.1');
  });
  it('never treats a proxy-marked request as direct setup, including empty or malformed headers', () => {
    expect(isDirectLoopback(req('127.0.0.1'))).toBe(true);
    for (const value of ['', 'not-an-ip', '203.0.113.9']) {
      expect(isDirectLoopback(req('127.0.0.1', { 'cf-connecting-ip': value }))).toBe(false);
    }
  });
  it('isHttps', () => {
    expect(isHttps(req('127.0.0.1', { 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(isHttps(req('10.0.0.5', { 'x-forwarded-proto': 'https' }))).toBe(false);
    expect(isHttps(req('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' }))).toBe(true);
    expect(isHttps(req('10.0.0.5', {}, 'https'))).toBe(true);
    expect(isHttps(req('127.0.0.1'))).toBe(false);
  });
});
