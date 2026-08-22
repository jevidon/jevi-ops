'use client';

import { useEffect, useState } from 'react';

// The Frame's <img>, client-side: the URL is typically a rotating feed
// (e.g. a photo-frame service's /api/current_image), so we cache-bust on a
// 5-minute bucket and re-render on the interval — the picture changes
// without a reload. The browser loads the URL directly: works over plain
// HTTP while the app itself is plain HTTP; if the app ever moves to HTTPS
// this becomes mixed content and should be proxied through the API.

const REFRESH_MS = 5 * 60 * 1000;

export function FrameImage({ src }: { src: string }) {
  const [bucket, setBucket] = useState(() => Math.floor(Date.now() / REFRESH_MS));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setFailed(false);
      setBucket(Math.floor(Date.now() / REFRESH_MS));
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (failed) {
    return (
      <div className="border border-line rounded px-4 py-6 text-center font-mono text-[10px] uppercase tracking-wider text-ink-3">
        Frame unavailable — is this device on the same network?
      </div>
    );
  }

  const sep = src.includes('?') ? '&' : '?';
  return (
    <div className="border border-line rounded overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- external
          feed on the local network; next/image can't optimize it and would
          proxy through the server, defeating the direct tailnet load. */}
      {/* Width fits the column, height follows the image's own aspect —
          never crop the feed (it may be a dashboard render where every
          region matters, not a photograph). */}
      <img
        src={`${src}${sep}t=${bucket}`}
        alt="Frame"
        onError={() => setFailed(true)}
        className="block w-full h-auto"
      />
    </div>
  );
}
