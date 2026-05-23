// YouTube URL helpers. Shared across the content list (thumbnails) and
// detail page (embed iframe). All functions take a raw user-pasted URL
// and return null for non-YouTube or otherwise unparseable inputs so
// the caller can decide whether to render anything.

// Extract the 11-char (or longer for Live IDs) video id from any common
// YouTube URL shape. Handles:
//   https://www.youtube.com/watch?v=ID
//   https://youtu.be/ID
//   https://youtube.com/shorts/ID
//   https://www.youtube.com/embed/ID
//   https://m.youtube.com/...
export function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') {
      id = u.pathname.replace(/^\//, '').split('/')[0] ?? null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        id = u.searchParams.get('v');
      } else if (u.pathname.startsWith('/shorts/')) {
        id = u.pathname.replace('/shorts/', '').split('/')[0] ?? null;
      } else if (u.pathname.startsWith('/embed/')) {
        id = u.pathname.replace('/embed/', '').split('/')[0] ?? null;
      } else if (u.pathname.startsWith('/live/')) {
        id = u.pathname.replace('/live/', '').split('/')[0] ?? null;
      }
    }
    if (!id || !/^[\w-]{6,}$/.test(id)) return null;
    return id;
  } catch {
    return null;
  }
}

export function youtubeEmbedUrl(url: string): string | null {
  const id = extractYouTubeVideoId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

// 16:9 thumbnail sizes available for every public video:
//   'mq' → 320×180 (good for list cards)
//   'hq' → 480×360 (has 4:3 black bars in some cases)
//   'sd' → 640×480 (also 4:3)
//   'maxres' → 1280×720 (may not exist for older / unprocessed videos)
export function youtubeThumbnailUrl(
  url: string,
  quality: 'mq' | 'hq' | 'sd' | 'maxres' = 'mq',
): string | null {
  const id = extractYouTubeVideoId(url);
  if (!id) return null;
  const file =
    quality === 'maxres' ? 'maxresdefault.jpg'
    : quality === 'sd' ? 'sddefault.jpg'
    : quality === 'hq' ? 'hqdefault.jpg'
    : 'mqdefault.jpg';
  return `https://img.youtube.com/vi/${id}/${file}`;
}
