import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  sub: string; // user id
  wid: string; // workspace id (the tenant)
}

export function signToken(userId: string, workspaceId: string): string {
  return jwt.sign({ sub: userId, wid: workspaceId } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || typeof decoded.wid !== 'string') {
    throw new Error('Malformed token');
  }
  return { sub: decoded.sub, wid: decoded.wid };
}
