import Hls from 'hls.js';
import { useEffect, useRef } from 'react';

interface Props {
  src: string;
  startAt?: number;
  onTimeSave?: (positionSec: number) => void;
  onEnded?: () => void;
}

export function HlsPlayer({ src, startAt = 0, onTimeSave, onEnded }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const saveRef = useRef(onTimeSave);
  saveRef.current = onTimeSave;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls: Hls | undefined;

    const seek = () => {
      if (startAt > 0) video.currentTime = startAt;
    };
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, seek);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.addEventListener('loadedmetadata', seek, { once: true });
    }

    // persist the resume point every 10s and when pausing
    const save = () => saveRef.current?.(Math.floor(video.currentTime));
    const timer = window.setInterval(() => !video.paused && save(), 10_000);
    video.addEventListener('pause', save);
    return () => {
      window.clearInterval(timer);
      video.removeEventListener('pause', save);
      hls?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return <video ref={ref} controls className="player" onEnded={onEnded} />;
}
