import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';

export interface AuthUser {
  id: string;
  role: Role;
}

export interface JwtPayload {
  sub: string;
  role: Role;
}

export function signToken(user: { id: string; role: Role }, secret = env.JWT_SECRET, expiresIn = env.JWT_EXPIRES_IN): string {
  return jwt.sign({ sub: user.id, role: user.role } satisfies JwtPayload, secret, {
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string, secret = env.JWT_SECRET): JwtPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === 'string' || !decoded.sub) throw new Error('Invalid token payload');
  return decoded as unknown as JwtPayload;
}
