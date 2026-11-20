import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildPlaybackInfo, type DeliveryConfig } from '../src/services/cloudfront';

const base: DeliveryConfig = { signMode: 'cookies', ttlSeconds: 3600, publicApiUrl: '' };
const hls = 'hls/lesson1/master.m3u8';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

describe('buildPlaybackInfo', () => {
  it('falls back to the local /media route without a CloudFront domain', () => {
    expect(buildPlaybackInfo(hls, base)).toEqual({ url: `/media/${hls}`, strategy: 'local' });
    expect(buildPlaybackInfo(`/${hls}`, { ...base, publicApiUrl: 'http://api.test/' }).url).toBe(`http://api.test/media/${hls}`);
  });

  it('returns a plain https CloudFront URL when signing is not configured', () => {
    const info = buildPlaybackInfo(hls, { ...base, cloudfrontDomain: 'd111.cloudfront.net' });
    expect(info).toEqual({ url: `https://d111.cloudfront.net/${hls}`, strategy: 'cloudfront' });
    expect(buildPlaybackInfo(hls, { ...base, cloudfrontDomain: 'https://cdn.example.com/' }).url).toBe(`https://cdn.example.com/${hls}`);
  });

  it('creates signed cookies scoped to the lesson folder', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const info = buildPlaybackInfo(hls, { ...base, cloudfrontDomain: 'cdn.example.com', keyPairId: 'K123', privateKey }, now);
    expect(info.strategy).toBe('cloudfront-signed-cookies');
    expect(info.cookiePolicyResource).toBe('https://cdn.example.com/hls/lesson1/*');
    expect(info.cookies).toMatchObject({ 'CloudFront-Key-Pair-Id': 'K123' });
    expect(info.cookies?.['CloudFront-Signature']).toBeTruthy();
    expect(info.expiresAt).toBe('2026-01-01T01:00:00.000Z');
  });

  it('creates a signed URL in url mode (and accepts keys with escaped newlines)', () => {
    const info = buildPlaybackInfo(hls, {
      ...base,
      signMode: 'url',
      cloudfrontDomain: 'cdn.example.com',
      keyPairId: 'K123',
      privateKey: privateKey.replace(/\n/g, '\\n'),
    });
    expect(info.strategy).toBe('cloudfront-signed-url');
    const url = new URL(info.url);
    expect(url.searchParams.get('Key-Pair-Id')).toBe('K123');
    expect(url.searchParams.get('Signature')).toBeTruthy();
    expect(url.searchParams.get('Expires')).toBeTruthy();
  });
});
