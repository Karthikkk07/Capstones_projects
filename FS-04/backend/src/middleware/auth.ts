import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyToken } from '../lib/jwt';
import { forbidden, unauthorized } from '../lib/errors';
import { hasPermission, type Permission } from '../permissions';

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/**
 * Verifies the bearer JWT and derives the tenant (workspaceId) from it.
 * The workspace is NEVER read from the request body, query or headers.
 * The membership is re-loaded on every request so role changes and removals
 * take effect immediately.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();

  let payload;
  try {
    payload = verifyToken(header.slice('Bearer '.length));
  } catch {
    throw unauthorized('Invalid or expired token');
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: payload.sub, workspaceId: payload.wid } },
    select: { role: true },
  });
  if (!membership) throw unauthorized('You are no longer a member of this workspace');

  req.auth = { userId: payload.sub, workspaceId: payload.wid, role: membership.role };
  next();
}

// Params are typed `any` so route handlers keep the precise `:param` string typing from their path.
export function requirePermission(permission: Permission): RequestHandler<any> {
  return (req, _res, next) => {
    if (!req.auth) throw unauthorized();
    if (!hasPermission(req.auth.role, permission)) {
      throw forbidden(`Role ${req.auth.role} lacks permission ${permission}`);
    }
    next();
  };
}

/** Typed accessor for handlers mounted behind `authenticate`. */
export function ctx(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
