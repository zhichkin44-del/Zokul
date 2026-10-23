// Small stroke icons shared across screens (no emoji in the UI).
export function BellOffIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M8.7 3.7A6 6 0 0 1 18 8c0 3.2.8 5.4 1.6 6.8M17 17H3s3-2 3-9c0-.6.1-1.2.3-1.8" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0M3 3l18 18" />
    </svg>
  );
}

export function BellIcon({ className = 'w-4 h-4 shrink-0' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  );
}

export function PaperclipIcon({ className = 'w-3.5 h-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5" />
    </svg>
  );
}
