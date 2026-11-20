import { AccessToken, type VideoGrant } from 'livekit-server-sdk';

export interface LiveKitConfig {
  apiKey: string;
  apiSecret: string;
  url: string;
}

export interface TokenRequest {
  identity: string;
  name: string;
  roomName: string;
  isHost: boolean;
  ttlSeconds?: number;
}

/** Instructors get full host rights; students can only subscribe and use data (chat) channels. */
export function buildVideoGrant(roomName: string, isHost: boolean): VideoGrant {
  if (isHost) {
    return {
      room: roomName,
      roomJoin: true,
      roomAdmin: true,
      roomCreate: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    };
  }
  return { room: roomName, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: true };
}

export async function createLiveKitToken(cfg: LiveKitConfig, req: TokenRequest): Promise<string> {
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: req.identity,
    name: req.name,
    ttl: req.ttlSeconds ?? 2 * 60 * 60,
  });
  token.addGrant(buildVideoGrant(req.roomName, req.isHost));
  return token.toJwt();
}
