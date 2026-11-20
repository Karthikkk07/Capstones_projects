import { env } from './env';
import type { DeliveryConfig } from '../services/cloudfront';

export function deliveryConfigFromEnv(): DeliveryConfig {
  return {
    cloudfrontDomain: env.CLOUDFRONT_DOMAIN,
    keyPairId: env.CLOUDFRONT_KEY_PAIR_ID,
    privateKey: env.CLOUDFRONT_PRIVATE_KEY,
    signMode: env.CLOUDFRONT_SIGN_MODE,
    ttlSeconds: env.CLOUDFRONT_URL_TTL_SECONDS,
    publicApiUrl: env.PUBLIC_API_URL,
  };
}
