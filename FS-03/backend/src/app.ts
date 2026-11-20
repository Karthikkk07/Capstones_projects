import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './routes/auth';
import { certificatesRouter } from './routes/certificates';
import { coursesRouter } from './routes/courses';
import { lessonsRouter } from './routes/lessons';
import { liveRouter } from './routes/live';
import { paymentsRouter, stripeWebhookRouter } from './routes/payments';
import { quizzesRouter } from './routes/quizzes';
import { revenueRouter } from './routes/revenue';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true }));

  // Raw-body webhook route has to be registered before the JSON body parser.
  app.use(stripeWebhookRouter);
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Local HLS fallback when CloudFront/S3 are not configured.
  app.use('/media', express.static(path.resolve(env.MEDIA_DIR), { index: false, fallthrough: true }));

  app.use('/auth', authRouter);
  app.use(coursesRouter);
  app.use(lessonsRouter);
  app.use(quizzesRouter);
  app.use(certificatesRouter);
  app.use(liveRouter);
  app.use(paymentsRouter);
  app.use(revenueRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
