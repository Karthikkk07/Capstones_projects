import { getSignedCookies, getSignedUrl } from '@aws-sdk/cloudfront-signer';

export interface DeliveryConfig {
  cloudfrontDomain?: string;
  keyPairId?: string;
  privateKey?: string;
  signMode: 'cookies' | 'url';
  ttlSeconds: number;
  /** Base URL of this API (used for the local /media fallback). Empty string => relative URL. */
  publicApiUrl: string;
}

export type PlaybackStrategy = 'local' | 'cloudfront' | 'cloudfront-signed-url' | 'cloudfront-signed-cookies';

export interface PlaybackInfo {
  url: string;
  strategy: PlaybackStrategy;
  expiresAt?: string;
  /** Cookies the client/browser must send to CloudFront (only for signed-cookie mode). */
  cookies?: Record<string, string>;
  /** Resource pattern the cookies are valid for. */
  cookiePolicyResource?: string;
}

const normaliseKey = (key: string) => key.replace(/\\n/g, '\n');

export function isSigningEnabled(cfg: DeliveryConfig): boolean {
  return Boolean(cfg.cloudfrontDomain && cfg.keyPairId && cfg.privateKey);
}

/**
 * Builds the playback URL for an HLS master playlist key such as "hls/<lessonId>/master.m3u8".
 *  - CLOUDFRONT_DOMAIN unset      -> local /media static route
 *  - domain only                  -> public https URL (use for public distributions / OAC with open behaviour)
 *  - domain + key pair + key      -> signed URL (single object) or signed cookies (whole lesson folder, needed for HLS segments)
 */
export function buildPlaybackInfo(hlsPath: string, cfg: DeliveryConfig, now: Date = new Date()): PlaybackInfo {
  const key = hlsPath.replace(/^\/+/, '');

  if (!cfg.cloudfrontDomain) {
    return { url: `${cfg.publicApiUrl.replace(/\/$/, '')}/media/${key}`, strategy: 'local' };
  }

  const domain = cfg.cloudfrontDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${domain}/${key}`;
  if (!isSigningEnabled(cfg)) return { url, strategy: 'cloudfront' };

  const expires = new Date(now.getTime() + cfg.ttlSeconds * 1000);
  const privateKey = normaliseKey(cfg.privateKey!);

  if (cfg.signMode === 'url') {
    const signed = getSignedUrl({ url, keyPairId: cfg.keyPairId!, privateKey, dateLessThan: expires });
    return { url: signed, strategy: 'cloudfront-signed-url', expiresAt: expires.toISOString() };
  }

  // HLS needs every segment request authorised, so sign a wildcard policy for the lesson folder.
  const folder = key.split('/').slice(0, -1).join('/');
  const resource = `https://${domain}/${folder}/*`;
  const policy = JSON.stringify({
    Statement: [
      { Resource: resource, Condition: { DateLessThan: { 'AWS:EpochTime': Math.floor(expires.getTime() / 1000) } } },
    ],
  });
  const cookies = getSignedCookies({ keyPairId: cfg.keyPairId!, privateKey, policy }) as unknown as Record<string, string>;
  return {
    url,
    strategy: 'cloudfront-signed-cookies',
    expiresAt: expires.toISOString(),
    cookies,
    cookiePolicyResource: resource,
  };
}
