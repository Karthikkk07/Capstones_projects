import type { Namespace, Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { type JwtPayload, verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { loadLiveClassForUser } from '../services/liveAccess';

export interface SocketUser {
  id: string;
  name: string;
  role: Role;
}

export interface ChatDeps {
  verify: (token: string) => JwtPayload;
  findUser: (id: string) => Promise<SocketUser | null>;
  /** Throws if the user may not access the live class. */
  assertAccess: (user: SocketUser, liveClassId: string) => Promise<unknown>;
  saveMessage: (liveClassId: string, userId: string, content: string) => Promise<{ id: string; createdAt: Date }>;
}

export const defaultChatDeps: ChatDeps = {
  verify: (token) => verifyToken(token),
  findUser: (id) => prisma.user.findUnique({ where: { id }, select: { id: true, name: true, role: true } }),
  assertAccess: (user, liveClassId) => loadLiveClassForUser({ id: user.id, role: user.role }, liveClassId),
  saveMessage: (liveClassId, userId, content) =>
    prisma.chatMessage.create({ data: { liveClassId, userId, content }, select: { id: true, createdAt: true } }),
};

/** Validates the JWT presented in the socket handshake and resolves the user. Throws on failure. */
export async function authenticateSocketToken(token: string | undefined, deps: Pick<ChatDeps, 'verify' | 'findUser'>): Promise<SocketUser> {
  if (!token) throw new Error('Authentication required');
  let payload: JwtPayload;
  try {
    payload = deps.verify(token);
  } catch {
    throw new Error('Invalid or expired token');
  }
  const user = await deps.findUser(payload.sub);
  if (!user) throw new Error('User not found');
  return user;
}

export function tokenFromHandshake(socket: Pick<Socket, 'handshake'>): string | undefined {
  const authToken = (socket.handshake.auth as { token?: string } | undefined)?.token;
  if (authToken) return authToken;
  const header = socket.handshake.headers?.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

const joinSchema = z.object({ liveClassId: z.string().min(1) });
const messageSchema = z.object({ liveClassId: z.string().min(1), content: z.string().trim().min(1).max(1000) });

type Ack = (res: { ok: boolean; error?: string; message?: unknown }) => void;
const roomOf = (liveClassId: string) => `live:${liveClassId}`;

export function registerChat(io: Server, deps: ChatDeps = defaultChatDeps): Namespace {
  const chat = io.of('/chat');

  chat.use(async (socket, next) => {
    try {
      socket.data.user = await authenticateSocketToken(tokenFromHandshake(socket), deps);
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  chat.on('connection', (socket) => {
    const user = socket.data.user as SocketUser;

    socket.on('join', async (payload: unknown, ack?: Ack) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: 'Invalid payload' });
      try {
        await deps.assertAccess(user, parsed.data.liveClassId);
        await socket.join(roomOf(parsed.data.liveClassId));
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.on('message', async (payload: unknown, ack?: Ack) => {
      const parsed = messageSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: 'Invalid message' });
      const { liveClassId, content } = parsed.data;
      if (!socket.rooms.has(roomOf(liveClassId))) return ack?.({ ok: false, error: 'Join the live class first' });
      try {
        const saved = await deps.saveMessage(liveClassId, user.id, content);
        const message = {
          id: saved.id,
          liveClassId,
          content,
          createdAt: saved.createdAt,
          user: { id: user.id, name: user.name, role: user.role },
        };
        chat.to(roomOf(liveClassId)).emit('message', message);
        ack?.({ ok: true, message });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });
  });

  return chat;
}
