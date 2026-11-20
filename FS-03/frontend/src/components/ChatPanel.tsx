import { useEffect, useRef, useState } from 'react';
import { type Socket, io } from 'socket.io-client';
import { TOKEN_KEY, api } from '../api/client';
import type { ChatMessage } from '../api/types';
import { useAuth } from '../context/AuthContext';

export function ChatPanel({ liveClassId, disabled }: { liveClassId: string; disabled?: boolean }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.liveMessages(liveClassId).then((r) => !cancelled && setMessages(r.items)).catch(() => undefined);

    const socket = io('/chat', { auth: { token: localStorage.getItem(TOKEN_KEY) } });
    socketRef.current = socket;
    socket.on('connect', () => {
      socket.emit('join', { liveClassId }, (res: { ok: boolean; error?: string }) => {
        setStatus(res.ok ? 'connected' : 'error');
        if (!res.ok) setError(res.error ?? 'Unable to join chat');
      });
    });
    socket.on('connect_error', (err) => {
      setStatus('error');
      setError(err.message);
    });
    socket.on('message', (m: ChatMessage) => setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m])));
    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [liveClassId]);

  useEffect(() => endRef.current?.scrollIntoView?.({ behavior: 'smooth' }), [messages]);

  function send() {
    const content = text.trim();
    if (!content || !socketRef.current) return;
    socketRef.current.emit('message', { liveClassId, content }, (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error ?? 'Message failed');
    });
    setText('');
  }

  return (
    <aside className="card chat">
      <h3>
        Chat <span className={`dot ${status}`} title={status} />
      </h3>
      <div className="chat-log" aria-live="polite">
        {messages.map((m) => (
          <p key={m.id} className={m.user.id === user?.id ? 'mine' : ''}>
            <strong>{m.user.name}</strong>
            {m.user.role === 'INSTRUCTOR' && <span className="badge">host</span>}
            <br />
            {m.content}
          </p>
        ))}
        <div ref={endRef} />
      </div>
      {error && <p className="error">{error}</p>}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={1000} disabled={disabled || status !== 'connected'} aria-label="Chat message" />
        <button className="btn btn-small" disabled={disabled || status !== 'connected'}>
          Send
        </button>
      </form>
    </aside>
  );
}
