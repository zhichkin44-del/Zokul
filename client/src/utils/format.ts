// "last seen …" for a person who is offline.
export function formatLastSeen(iso?: string, now: Date = new Date()): string {
  if (!iso) return 'Offline';
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return 'Last seen just now';
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return `Last seen today at ${time}`;
  if (date.getTime() >= startOfToday - 86400000) return `Last seen yesterday at ${time}`;
  return `Last seen ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
