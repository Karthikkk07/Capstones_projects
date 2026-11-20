import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { VideoStatus } from '../api/types';
import { errorMessage } from '../lib/useAsync';

const labels: Record<VideoStatus, string> = {
  PENDING: 'Queued for processing…',
  PROCESSING: 'Transcoding to HLS…',
  READY: 'Ready',
  FAILED: 'Processing failed',
};

export function VideoUploader({ lessonId, initialStatus, onChange }: { lessonId: string; initialStatus: VideoStatus; onChange?: () => void }) {
  const [status, setStatus] = useState<VideoStatus>(initialStatus);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Poll the processing status while the worker is busy
  useEffect(() => {
    if (status !== 'PENDING' && status !== 'PROCESSING') return;
    const timer = window.setInterval(async () => {
      try {
        const res = await api.videoStatus(lessonId);
        setStatus(res.videoStatus);
        if (res.videoStatus === 'READY' || res.videoStatus === 'FAILED') onChange?.();
      } catch (e) {
        setError(errorMessage(e));
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [status, lessonId, onChange]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadVideo(lessonId, file);
      setStatus('PENDING');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="uploader">
      <span className={`badge status-${status.toLowerCase()}`}>{labels[status]}</span>
      <input ref={fileRef} type="file" accept="video/*" aria-label="Video file" />
      <button className="btn btn-small" onClick={upload} disabled={uploading}>
        {uploading ? 'Uploading…' : status === 'READY' ? 'Replace video' : 'Upload video'}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
