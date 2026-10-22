import { describe, it, expect } from 'vitest';
import { formatFileSize, formatLastSeen } from '../src/utils/format';

describe('formatLastSeen', () => {
  const now = new Date(2026, 9, 22, 18, 0);
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();

  it('describes recent and older visits', () => {
    expect(formatLastSeen(undefined, now)).toBe('Offline');
    expect(formatLastSeen(ago(0), now)).toBe('Last seen just now');
    expect(formatLastSeen(ago(5), now)).toBe('Last seen 5 min ago');
    expect(formatLastSeen(ago(120), now)).toMatch(/^Last seen today at /);
    expect(formatLastSeen(ago(20 * 60), now)).toMatch(/^Last seen yesterday at /);
    expect(formatLastSeen(ago(5 * 24 * 60), now)).toMatch(/^Last seen \d/);
  });
});

describe('formatFileSize', () => {
  it('uses readable units', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});
