import { useState, useEffect } from 'react';

// Muted tints defined per theme in index.css (.avatar-tint-0 … -5).
const TINTS = 6;

function getTintForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `avatar-tint-${Math.abs(hash) % TINTS}`;
}

interface AvatarProps {
  name: string;
  url?: string;
  size?: number;
  // Agents and rooms are drawn as rounded squares, people as circles.
  square?: boolean;
}

export default function Avatar({ name, url, size = 40, square = false }: AvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [url]);

  const initials = (name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).map((w) => w[0]).join('') || '?').toUpperCase().slice(0, 2);
  if (url && !imgError) {
    return <img key={url} src={url} alt={name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} onError={() => setImgError(true)} />;
  }
  return (
    <div
      className={`${square ? 'rounded-[30%]' : 'rounded-full'} ${getTintForName(name)} flex items-center justify-center font-semibold shrink-0`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}
