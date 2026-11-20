import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './routes/auth';
import { workspaceRouter } from './routes/workspace';
import { projectsRouter } from './routes/projects';
import { boardsRouter } from './routes/boards';
import { issuesRouter } from './routes/issues';
import { commentsRouter } from './routes/comments';
import { attachmentsRouter } from './routes/attachments';
import { sprintsRouter } from './routes/sprints';
import { reportsRouter } from './routes/reports';
import { auditRouter } from './routes/audit';
import { webhooksRouter } from './routes/webhooks';
import { billingRouter, stripeWebhookRouter } from './routes/billing';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind nginx / a load balancer

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== 'test' }));

  const health: express.RequestHandler = (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  };
  app.get('/health', health);
  app.get('/api/health', health);

  // Stripe needs the raw request body, so this must be registered before express.json().
  app.use('/api', stripeWebhookRouter);
  app.use(express.json({ limit: '1mb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' } },
  });
  app.use(['/api/auth/login', '/api/auth/register'], authLimiter);
  app.use('/api', authRouter);

  // Everything below requires a valid JWT; the tenant (workspaceId) comes from it.
  const protectedRouter = Router();
  protectedRouter.use(authenticate);
  protectedRouter.use(workspaceRouter);
  protectedRouter.use(projectsRouter);
  protectedRouter.use(boardsRouter);
  protectedRouter.use(issuesRouter);
  protectedRouter.use(commentsRouter);
  protectedRouter.use(attachmentsRouter);
  protectedRouter.use(sprintsRouter);
  protectedRouter.use(reportsRouter);
  protectedRouter.use(auditRouter);
  protectedRouter.use(webhooksRouter);
  protectedRouter.use(billingRouter);
  app.use('/api', protectedRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
