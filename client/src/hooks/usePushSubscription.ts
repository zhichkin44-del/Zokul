import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export type PushStatus =
  | 'unsupported' // no Push API (e.g. iOS Safari outside an installed home-screen app)
  | 'needs-install' // iOS: push works only after "Add to Home Screen"
  | 'default' // supported, user has not decided yet: show the enable button
  | 'denied'
  | 'granted';

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function currentStatus(): PushStatus {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  return Notification.permission as PushStatus;
}

// Ensures this browser has a push subscription and that the server knows it.
// Sending it on every start makes push self-healing after a server DB reset.
async function syncSubscription(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const res = await fetch('/api/push/vapid-key');
    const { publicKey } = await res.json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  }
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
}

export function usePushSubscription() {
  const { user } = useAuth();
  const [status, setStatus] = useState<PushStatus>(() => currentStatus());

  useEffect(() => {
    if (!user || status !== 'granted') return;
    syncSubscription().catch(() => {
      // push subscription is best-effort
    });
  }, [user, status]);

  // Must run from a tap: iOS only allows the permission prompt on a user gesture.
  const enable = useCallback(async () => {
    if (currentStatus() !== 'default') return;
    const result = await Notification.requestPermission();
    setStatus(result as PushStatus);
  }, []);

  return { status, enable };
}
