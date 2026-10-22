import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { Message, User } from '../../types';

interface SearchPanelProps {
  chatId: string;
  participants: User[];
  onPick: (messageId: string) => void;
  onClose: () => void;
}

// Search inside the open chat; picking a result scrolls to it.
export default function SearchPanel({ chatId, participants, onPick, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [searched, setSearched] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (value: string) => {
    setQuery(value);
    clearTimeout(timer.current);
    if (!value.trim()) {
      setResults([]);
      setSearched('');
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await api.get<Message[]>(`/chats/${chatId}/messages/search`, { params: { q: value } });
        setResults(res.data);
      } catch {
        setResults([]);
      }
      setSearched(value);
    }, 300);
  };

  const pending = query.trim() !== '' && searched !== query;
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? '';

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900">
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder="Search in this chat…"
          className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button onClick={onClose} className="text-sm text-gray-500 px-2" aria-label="Close search">Close</button>
      </div>
      {query.trim() && (
        <div className="max-h-64 overflow-y-auto pb-2">
          {pending && <p className="px-4 py-2 text-xs text-gray-400">Searching…</p>}
          {!pending && results.length === 0 && <p className="px-4 py-2 text-xs text-gray-400">Nothing found</p>}
          {!pending && results.map((m) => (
            <button
              key={m.id}
              onClick={() => onPick(m.id)}
              className="w-full text-left px-4 py-2 hover:bg-gray-200 dark:hover:bg-gray-800"
            >
              <div className="flex justify-between gap-2 text-[11px] text-gray-400">
                <span className="truncate">{nameOf(m.senderId)}</span>
                <span className="shrink-0">{new Date(m.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="text-sm truncate">{m.text || m.file?.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
