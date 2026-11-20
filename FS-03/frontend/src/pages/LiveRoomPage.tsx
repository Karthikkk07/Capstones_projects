import { LocalTrackPublication, type Participant, RemoteTrack, Room, RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ChatPanel } from '../components/ChatPanel';
import { formatDateTime } from '../lib/format';
import { errorMessage, useAsync } from '../lib/useAsync';

type AnyTrack = RemoteTrack | NonNullable<LocalTrackPublication['track']>;

export function LiveRoomPage() {
  const { id = '' } = useParams();
  const info = useAsync(() => api.getLiveClass(id), [id]);
  const tilesRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTile = useCallback((track: AnyTrack, participant: Participant) => {
    const container = tilesRef.current;
    if (!container) return;
    const sid = track.sid ?? `${participant.identity}-${track.kind}`;
    const tile = container.querySelector(`[data-tile="${participant.identity}"]`) ?? Object.assign(document.createElement('div'), { className: 'tile' });
    tile.setAttribute('data-tile', participant.identity);
    if (!tile.querySelector('.tile-name')) {
      const name = document.createElement('span');
      name.className = 'tile-name';
      name.textContent = participant.name || participant.identity;
      tile.appendChild(name);
    }
    const el = track.attach();
    el.setAttribute('data-track', sid);
    tile.appendChild(el);
    container.appendChild(tile);
  }, []);

  const removeTile = useCallback((track: AnyTrack) => {
    track.detach().forEach((el) => el.remove());
  }, []);

  async function join() {
    setError(null);
    try {
      const { token, url, role } = await api.liveToken(id);
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room
        .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => addTile(track, participant))
        .on(RoomEvent.TrackUnsubscribed, (track) => removeTile(track))
        .on(RoomEvent.LocalTrackPublished, (pub, participant) => pub.track && addTile(pub.track, participant))
        .on(RoomEvent.LocalTrackUnpublished, (pub) => pub.track && removeTile(pub.track))
        .on(RoomEvent.Disconnected, () => setConnected(false));
      await room.connect(url, token);
      setConnected(true);
      setCanPublish(role === 'host');
      // existing remote tracks (late joiners)
      room.remoteParticipants.forEach((p) =>
        p.trackPublications.forEach((pub) => pub.track && addTile(pub.track, p)),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function toggleMic() {
    const next = !micOn;
    await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  async function toggleCam() {
    const next = !camOn;
    await roomRef.current?.localParticipant.setCameraEnabled(next);
    setCamOn(next);
  }

  function leave() {
    roomRef.current?.disconnect();
    if (tilesRef.current) tilesRef.current.innerHTML = '';
    setConnected(false);
    setMicOn(false);
    setCamOn(false);
  }

  useEffect(
    () => () => {
      void roomRef.current?.disconnect();
    },
    [],
  );

  async function setStatus(action: 'start' | 'end') {
    try {
      await (action === 'start' ? api.startLive(id) : api.endLive(id));
      await info.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (info.loading && !info.data) return <p className="muted">Loading…</p>;
  if (info.error || !info.data) return <p className="error">{info.error ?? 'Live class not found'}</p>;
  const lc = info.data;
  const isHost = Boolean(lc.isHost);

  return (
    <div>
      <Link to={`/courses/${lc.courseId}`}>← Back</Link>
      <div className="row between">
        <h1>
          {lc.title} <span className="badge">{lc.status}</span>
        </h1>
        <span className="muted">{formatDateTime(lc.scheduledAt)}</span>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="live">
        <div>
          <div className="tiles" ref={tilesRef} data-testid="tiles" />
          {!connected && <p className="muted">{lc.status === 'LIVE' || isHost ? 'Press "Join room" to connect.' : 'The class has not started yet.'}</p>}
          <div className="row">
            {!connected ? (
              <button className="btn" onClick={join} disabled={lc.status === 'ENDED' || (!isHost && lc.status !== 'LIVE')}>
                Join room
              </button>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={toggleMic} disabled={!canPublish} title={canPublish ? '' : 'Only the host can speak'}>
                  {micOn ? '🎙 Mute' : '🔇 Unmute'}
                </button>
                <button className="btn btn-ghost" onClick={toggleCam} disabled={!canPublish}>
                  {camOn ? '📷 Camera off' : '🚫 Camera on'}
                </button>
                <button className="btn btn-danger" onClick={leave}>
                  Leave
                </button>
              </>
            )}
            {isHost && lc.status === 'SCHEDULED' && (
              <button className="btn" onClick={() => setStatus('start')}>
                Start class
              </button>
            )}
            {isHost && lc.status === 'LIVE' && (
              <button className="btn btn-danger" onClick={() => setStatus('end')}>
                End class
              </button>
            )}
          </div>
        </div>
        <ChatPanel liveClassId={id} disabled={lc.status === 'ENDED'} />
      </div>
    </div>
  );
}
