import React, { useEffect, useState } from 'react';

export const resolvedPlaylistCoverMemoryCache = new Map<string, string>();
export const failedPlaylistCoverLookupIds = new Set<string>();

export interface ResilientTileArtworkProps {
  src?: string | null;
  fallbackIcon: string;
  bg: string;
  border: string;
  playlistCoverId?: string;
  playlistKind?: string;
  onResolvedCover?: (url: string) => void;
}

export const ResilientTileArtwork: React.FC<ResilientTileArtworkProps> = ({
  src,
  fallbackIcon,
  bg,
  border,
  playlistCoverId,
  playlistKind,
  onResolvedCover,
}) => {
  const cachedOverride = playlistCoverId
    ? resolvedPlaylistCoverMemoryCache.get(playlistCoverId)
    : undefined;
  const effectiveSrc = cachedOverride || src || null;
  const [currentSrc, setCurrentSrc] = useState<string | null>(effectiveSrc);
  const [retried, setRetried] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    const next =
      (playlistCoverId ? resolvedPlaylistCoverMemoryCache.get(playlistCoverId) : undefined) ||
      src ||
      null;
    setCurrentSrc(next);
    setRetried(false);
    setFailed(false);
  }, [src, playlistCoverId]);

  const handleImgError = () => {
    if (!retried && currentSrc && !currentSrc.includes('blobstore.apple.com')) {
      setRetried(true);
      const jitter = 500 + Math.floor(Math.random() * 700);
      window.setTimeout(() => {
        const sep = currentSrc.includes('?') ? '&' : '?';
        setCurrentSrc(`${currentSrc}${sep}retry=1`);
      }, jitter);
      return;
    }

    if (playlistCoverId && !failedPlaylistCoverLookupIds.has(playlistCoverId)) {
      failedPlaylistCoverLookupIds.add(playlistCoverId);
      fetch(
        `/api/apple/playlist-cover?id=${encodeURIComponent(playlistCoverId)}&kind=${encodeURIComponent(
          playlistKind || 'library'
        )}&force=1`
      )
        .then((r) => r.json())
        .then((d) => {
          if (d?.ok && d?.art_url) {
            resolvedPlaylistCoverMemoryCache.set(playlistCoverId, d.art_url);
            setCurrentSrc(d.art_url);
            setFailed(false);
            onResolvedCover?.(d.art_url);
          } else {
            setFailed(true);
          }
        })
        .catch(() => setFailed(true));
      return;
    }

    setFailed(true);
  };

  if (currentSrc && !failed) {
    return (
      <img
        src={currentSrc}
        alt=""
        loading="lazy"
        decoding="async"
        onError={handleImgError}
        style={{
          width: 56,
          height: 56,
          borderRadius: 10,
          objectFit: 'cover',
          border: '1px solid #262632',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: 10,
        background: bg,
        border,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        flexShrink: 0,
      }}
    >
      {fallbackIcon}
    </div>
  );
};
