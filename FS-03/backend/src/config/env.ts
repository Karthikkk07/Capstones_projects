import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://lms:lms@localhost:5432/lms'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(8).default('dev-only-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  UPLOAD_DIR: z.string().default('uploads'),
  MEDIA_DIR: z.string().default('media'),
  MAX_UPLOAD_MB: z.coerce.number().default(500),
  PUBLIC_API_URL: z.string().default(''),

  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  CLOUDFRONT_DOMAIN: z.string().optional(),
  CLOUDFRONT_KEY_PAIR_ID: z.string().optional(),
  CLOUDFRONT_PRIVATE_KEY: z.string().optional(),
  CLOUDFRONT_SIGN_MODE: z.enum(['cookies', 'url']).default('cookies'),
  CLOUDFRONT_COOKIE_DOMAIN: z.string().optional(),
  CLOUDFRONT_URL_TTL_SECONDS: z.coerce.number().default(3600),

  LIVEKIT_API_KEY: z.string().default('devkey'),
  LIVEKIT_API_SECRET: z.string().default('secretsecretsecretsecretsecret12'),
  LIVEKIT_URL: z.string().default('ws://localhost:7880'),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  INSTRUCTOR_SHARE_PCT: z.coerce.number().min(0).max(100).default(80),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  KEEP_LOCAL_AFTER_S3: bool,
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET === 'dev-only-secret-change-me') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return parsed.data;
}

export const env: Env = loadEnv();
