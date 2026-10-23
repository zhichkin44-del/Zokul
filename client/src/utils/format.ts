import { t } from '../i18n';

// "last seen …" for a person who is offline.
export function formatLastSeen(iso?: string, now: Date = new Date()): string {
  if (!iso) return t('Offline');
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return t('Last seen just now');
  if (minutes < 60) return t('Last seen {n} min ago', { n: minutes });
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return t('Last seen today at {time}', { time });
  if (date.getTime() >= startOfToday - 86400000) return t('Last seen yesterday at {time}', { time });
  return t('Last seen {date}', { date: date.toLocaleDateString([], { day: 'numeric', month: 'short' }) });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
