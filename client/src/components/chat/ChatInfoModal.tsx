import { useEffect, useState } from 'react';
import api from '../../services/api';
import { Agent, Chat, User } from '../../types';
import Avatar from '../common/Avatar';
import { formatLastSeen } from '../../utils/format';

interface ChatInfoModalProps {
  chat: Chat;
  currentUserId: string;
  isOnline: (userId: string) => boolean;
  lastSeenOf: (userId: string, fallback?: string) => string | undefined;
  onClose: () => void;
  onChanged: () => void;
}

type ApiError = { response?: { data?: { error?: string } } };
const errorText = (err: unknown, fallback: string) => (err as ApiError).response?.data?.error || fallback;

// Profile of the other person (direct chat) or group settings: name,
// members, adding people and your own agents, leaving; mute for both.
export default function ChatInfoModal({ chat, currentUserId, isOnline, lastSeenOf, onClose, onChanged }: ChatInfoModalProps) {
  const isGroup = chat.isGroup === true;
  const isCreator = isGroup && chat.creatorId === currentUserId;
  const other = chat.participants.find((p) => p.id !== currentUserId);
  const [muted, setMuted] = useState(chat.muted === true);
  const [name, setName] = useState(chat.name || '');
  const [error, setError] = useState('');

  const statusOf = (u: User) => (u.isAgent ? 'AI agent' : isOnline(u.id) ? 'Online' : formatLastSeen(lastSeenOf(u.id, u.lastSeenAt)));

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError('');
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(errorText(err, fallback));
    }
  };

  const toggleMute = () => run(async () => {
    await api.patch(`/chats/${chat.id}/mute`, { muted: !muted });
    setMuted(!muted);
  }, 'Could not change notifications');

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 dark:bg-black/60 overflow-y-auto py-6" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden" role="dialog" aria-modal="true" aria-label={isGroup ? 'Group info' : 'Profile'}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">{isGroup ? 'Group info' : 'Profile'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {!isGroup && other && (
            <div className="flex flex-col items-center text-center gap-2">
              <Avatar name={other.name} size={72} url={other.avatarUrl} />
              <div className="text-lg font-semibold">{other.name}</div>
              <div className="text-sm text-gray-500">{statusOf(other)}</div>
            </div>
          )}

          {isGroup && (
            isCreator ? (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api.patch(`/chats/${chat.id}`, { name }), 'Could not rename'); }}>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary" aria-label="Group name" />
                <button type="submit" disabled={!name.trim() || name === chat.name} className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40">Rename</button>
              </form>
            ) : (
              <div className="text-lg font-semibold">{chat.name}</div>
            )
          )}

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm">Notifications</span>
            <button type="button" role="switch" aria-checked={!muted} onClick={toggleMute} className={`w-11 h-6 rounded-full transition-colors relative ${muted ? 'bg-gray-300 dark:bg-gray-700' : 'bg-primary'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${muted ? 'left-0.5' : 'left-[22px]'}`} />
            </button>
          </label>

          {isGroup && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{chat.participants.length} members</div>
              {chat.participants.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <Avatar name={p.name} size={32} url={p.avatarUrl} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.name}{p.id === currentUserId ? ' (you)' : ''}{p.id === chat.creatorId ? ' · creator' : ''}
                    </div>
                    <div className="text-xs text-gray-500">{statusOf(p)}</div>
                  </div>
                  {isCreator && p.id !== currentUserId && (
                    <button onClick={() => run(() => api.delete(`/chats/${chat.id}/members/${p.id}`), 'Could not remove')} className="text-xs text-red-500 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">Remove</button>
                  )}
                </div>
              ))}
              {isCreator && <AddMembers chat={chat} onAdd={(userId) => run(() => api.post(`/chats/${chat.id}/members`, { userId }), 'Could not add')} />}
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          {isGroup && !isCreator && (
            <button
              onClick={() => run(async () => { await api.delete(`/chats/${chat.id}/members/${currentUserId}`); onClose(); }, 'Could not leave')}
              className="w-full py-2 rounded-lg text-red-500 font-medium hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              Leave group
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddMembers({ chat, onAdd }: { chat: Chat; onAdd: (userId: string) => void }) {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<User[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    api.get<Agent[]>('/agents').then((res) => setAgents(res.data)).catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    if (!query.trim()) { setPeople([]); return; }
    const t = setTimeout(() => {
      api.get<User[]>('/users/search', { params: { q: query } }).then((res) => setPeople(res.data)).catch(() => setPeople([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const notMember = (id: string) => !chat.participantIds.includes(id);
  const candidates = [
    ...agents.filter((a) => notMember(a.id)).map((a) => ({ id: a.id, name: a.name, note: 'your agent' })),
    ...people.filter((p) => notMember(p.id)).map((p) => ({ id: p.id, name: p.name, note: '' })),
  ];

  return (
    <div className="pt-2 space-y-2">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add people by name…" className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
      {candidates.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{c.name}{c.note && <span className="text-gray-400"> · {c.note}</span>}</span>
          <button onClick={() => onAdd(c.id)} className="text-xs font-medium text-primary px-2 py-1 rounded hover:bg-primary/10">Add</button>
        </div>
      ))}
    </div>
  );
}
