import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { buildVideoGrant, createLiveKitToken } from '../src/services/livekit';
import { type ChatDeps, authenticateSocketToken, registerChat, tokenFromHandshake } from '../src/realtime/chat';
import { signToken, verifyToken } from '../src/lib/jwt';

const cfg = { apiKey: 'testkey', apiSecret: 'testsecret-testsecret-testsecret-1234', url: 'ws://localhost:7880' };

describe('LiveKit tokens', () => {
  const decode = async (isHost: boolean) => {
    const token = await createLiveKitToken(cfg, { identity: 'user1', name: 'Una User', roomName: 'room-1', isHost });
    return jwt.verify(token, cfg.apiSecret) as jwt.JwtPayload & { video: Record<string, unknown>; name: string };
  };

  it('issues host permissions to the instructor', async () => {
    const claims = await decode(true);
    expect(claims.iss).toBe('testkey');
    expect(claims.sub).toBe('user1');
    expect(claims.name).toBe('Una User');
    expect(claims.video).toMatchObject({ room: 'room-1', roomJoin: true, roomAdmin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  });

  it('issues subscribe-only (+ data/chat) permissions to students', async () => {
    const claims = await decode(false);
    expect(claims.video).toMatchObject({ room: 'room-1', roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: true });
    expect(claims.video.roomAdmin).toBeUndefined();
  });

  it('expires the token', async () => {
    const claims = await decode(false);
    expect(claims.exp! - claims.nbf!).toBeGreaterThan(0);
    expect(buildVideoGrant('r', false).canPublish).toBe(false);
  });
});

describe('socket authentication', () => {
  const user = { id: 'u1', name: 'Una', role: 'STUDENT' as const };
  const deps = { verify: verifyToken, findUser: vi.fn().mockResolvedValue(user) };

  it('accepts a valid JWT', async () => {
    const token = signToken({ id: 'u1', role: 'STUDENT' });
    await expect(authenticateSocketToken(token, deps)).resolves.toEqual(user);
  });

  it('rejects missing, malformed and unknown-user tokens', async () => {
    await expect(authenticateSocketToken(undefined, deps)).rejects.toThrow(/required/i);
    await expect(authenticateSocketToken('garbage', deps)).rejects.toThrow(/invalid/i);
    const ghost = { verify: verifyToken, findUser: vi.fn().mockResolvedValue(null) };
    await expect(authenticateSocketToken(signToken({ id: 'x', role: 'STUDENT' }), ghost)).rejects.toThrow(/not found/i);
  });

  it('reads the token from handshake auth or the Authorization header', () => {
    expect(tokenFromHandshake({ handshake: { auth: { token: 'abc' }, headers: {} } } as any)).toBe('abc');
    expect(tokenFromHandshake({ handshake: { auth: {}, headers: { authorization: 'Bearer xyz' } } } as any)).toBe('xyz');
    expect(tokenFromHandshake({ handshake: { auth: {}, headers: {} } } as any)).toBeUndefined();
  });
});

describe('chat namespace', () => {
  function setup(overrides: Partial<ChatDeps> = {}) {
    const emit = vi.fn();
    const nsp: any = { use: vi.fn(), on: vi.fn(), to: vi.fn(() => ({ emit })) };
    const deps: ChatDeps = {
      verify: verifyToken,
      findUser: vi.fn().mockResolvedValue({ id: 'u1', name: 'Una', role: 'STUDENT' }),
      assertAccess: vi.fn().mockResolvedValue(undefined),
      saveMessage: vi.fn().mockResolvedValue({ id: 'm1', createdAt: new Date('2026-01-01') }),
      ...overrides,
    };
    registerChat({ of: () => nsp } as any, deps);

    const handlers: Record<string, (...a: any[]) => Promise<void>> = {};
    const socket: any = {
      data: { user: { id: 'u1', name: 'Una', role: 'STUDENT' } },
      rooms: new Set<string>(),
      join: vi.fn(async (room: string) => socket.rooms.add(room)),
      on: (event: string, h: any) => (handlers[event] = h),
    };
    nsp.on.mock.calls[0][1](socket); // fire 'connection'
    return { nsp, socket, handlers, deps, emit };
  }

  it('refuses connections without a valid JWT', async () => {
    const { nsp } = setup();
    const middleware = nsp.use.mock.calls[0][0];
    const next = vi.fn();
    await middleware({ handshake: { auth: {}, headers: {} }, data: {} }, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);

    const okSocket: any = { handshake: { auth: { token: signToken({ id: 'u1', role: 'STUDENT' }) }, headers: {} }, data: {} };
    const next2 = vi.fn();
    await middleware(okSocket, next2);
    expect(next2).toHaveBeenCalledWith();
    expect(okSocket.data.user.id).toBe('u1');
  });

  it('persists and broadcasts messages after joining', async () => {
    const { handlers, deps, emit, nsp } = setup();
    const ack = vi.fn();
    await handlers.join({ liveClassId: 'lc1' }, ack);
    expect(ack).toHaveBeenLastCalledWith({ ok: true });

    await handlers.message({ liveClassId: 'lc1', content: '  hello  ' }, ack);
    expect(deps.saveMessage).toHaveBeenCalledWith('lc1', 'u1', 'hello');
    expect(nsp.to).toHaveBeenCalledWith('live:lc1');
    expect(emit).toHaveBeenCalledWith('message', expect.objectContaining({ content: 'hello', user: expect.objectContaining({ name: 'Una' }) }));
  });

  it('blocks messages before joining and when access is denied', async () => {
    const denied = setup({ assertAccess: vi.fn().mockRejectedValue(new Error('Enroll first')) });
    const ack = vi.fn();
    await denied.handlers.message({ liveClassId: 'lc1', content: 'hi' }, ack);
    expect(ack).toHaveBeenLastCalledWith({ ok: false, error: 'Join the live class first' });
    await denied.handlers.join({ liveClassId: 'lc1' }, ack);
    expect(ack).toHaveBeenLastCalledWith({ ok: false, error: 'Enroll first' });
    expect(denied.deps.saveMessage).not.toHaveBeenCalled();
  });

  it('rejects empty or oversized messages', async () => {
    const { handlers, deps } = setup();
    const ack = vi.fn();
    await handlers.join({ liveClassId: 'lc1' }, ack);
    await handlers.message({ liveClassId: 'lc1', content: '   ' }, ack);
    await handlers.message({ liveClassId: 'lc1', content: 'x'.repeat(1001) }, ack);
    expect(ack).toHaveBeenLastCalledWith({ ok: false, error: 'Invalid message' });
    expect(deps.saveMessage).not.toHaveBeenCalled();
  });
});
