import { useState } from 'react';

const base = 'https://image.tmdb.org/t/p';

// External TMDb image only. A film without a poster, or whose poster fails to load, shows none:
// no placeholder, and the space for it closes up.
export function Poster({ path, title }: { path?: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!path || failed) {
    return null;
  }
  return (
    <img
      className="poster"
      src={`${base}/w185${path}`}
      srcSet={`${base}/w185${path} 1x, ${base}/w342${path} 2x`}
      alt={`《${title}》海报`}
      width={92}
      height={138}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
