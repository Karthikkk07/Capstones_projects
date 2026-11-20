import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@prisma/client';
import { HttpError } from '../lib/errors';
import { type AuthUser, verifyToken } from '../lib/jwt';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function extractBearer(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export const authenticate: RequestHandler = (req, _res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (!token) return next(HttpError.unauthorized());
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(HttpError.unauthorized('Invalid or expired token'));
  }
};

export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (token) {
    try {
      const payload = verifyToken(token);
      req.user = { id: payload.sub, role: payload.role };
    } catch {
      // ignore invalid tokens on public endpoints
    }
  }
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(HttpError.unauthorized());
    if (!roles.includes(req.user.role)) return next(HttpError.forbidden(`Requires role: ${roles.join(' or ')}`));
    next();
  };

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw HttpError.unauthorized();
  return req.user;
}
