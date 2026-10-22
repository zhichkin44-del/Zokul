import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';

export function usePresence(currentUserId?: string) {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set(currentUserId ? [currentUserId] : []));
  // Fresh "last seen" times from presence updates (newer than the chat list).
  const [lastSeen, setLastSeen] = useState<Map<string, string>>(new Map());
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;

    const handler = (data: { userId: string; status: 'online' | 'offline'; lastSeenAt?: string }) => {
      if (data.userId === currentUserId) return;
      if (data.lastSeenAt) setLastSeen((prev) => new Map(prev).set(data.userId, data.lastSeenAt!));
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        if (data.status === 'online') {
          next.add(data.userId);
        } else {
          next.delete(data.userId);
        }
        return next;
      });
    };

    const heartbeat = () => {
      socket.emit('heartbeat');
    };

    socket.on('presence:update', handler);
    const interval = setInterval(heartbeat, 15000);

    return () => {
      socket.off('presence:update', handler);
      clearInterval(interval);
    };
  }, [socket, currentUserId]);

  const isOnline = useCallback(
    (userId: string) => userId === currentUserId || onlineUsers.has(userId),
    [onlineUsers, currentUserId]
  );

  const lastSeenOf = useCallback((userId: string, fallback?: string) => lastSeen.get(userId) ?? fallback, [lastSeen]);

  return { isOnline, onlineUsers, lastSeenOf };
}
