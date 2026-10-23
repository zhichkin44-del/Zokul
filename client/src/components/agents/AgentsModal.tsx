import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { Agent } from '../../types';
import { t } from '../../i18n';

interface AgentsModalProps {
  open: boolean;
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
  onChanged: () => void;
}

interface Issued {
  agentName: string;
  token: string;
}

function timeAgo(iso?: string): string {
  if (!iso) return t('never connected');
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return t('active just now');
  if (minutes < 60) return t('active {n} min ago', { n: minutes });
  if (minutes < 1440) return t('active {n} h ago', { n: Math.round(minutes / 60) });
  return t('active {date}', { date: new Date(iso).toLocaleDateString() });
}

// Manage AI agents: create, show the one-time token with setup commands,
// rotate or delete. The token is never shown again after this screen.
export default function AgentsModal({ open, onClose, onOpenChat, onChanged }: AgentsModalProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Agent[]>('/agents');
      setAgents(res.data);
    } catch {
      setError('Could not load agents');
    }
  }, []);

  useEffect(() => {
    if (open) {
      setIssued(null);
      setError('');
      setName('');
      load();
    }
  }, [open, load]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ agent: Agent; chatId: string; token: string }>('/agents', { name: name.trim() });
      setIssued({ agentName: res.data.agent.name, token: res.data.token });
      setName('');
      await load();
      onChanged();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Could not create agent');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (agent: Agent) => {
    if (!window.confirm(`Issue a new token for ${agent.name}? The old one stops working immediately.`)) return;
    const res = await api.post<{ token: string }>(`/agents/${agent.id}/token`);
    setIssued({ agentName: agent.name, token: res.data.token });
  };

  const remove = async (agent: Agent) => {
    if (!window.confirm(`Delete ${agent.name} and its chat history?`)) return;
    await api.delete(`/agents/${agent.id}`);
    await load();
    onChanged();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 dark:bg-black/60 overflow-y-auto py-6" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" role="dialog" aria-modal="true" aria-label={t('AI agents')}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-display text-xl font-semibold">{t('AI agents')}</h2>
            <p className="text-xs text-gray-500">{t('Agents post status, ask you questions and leave handoffs here.')}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={t('Close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {issued ? (
            <TokenPanel issued={issued} onDone={() => setIssued(null)} />
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create(); }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('Agent name, e.g. Claude Code')}
                autoFocus
                maxLength={60}
                className="flex-1 min-w-0 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button type="submit" disabled={!name.trim() || busy} className="px-4 py-2 rounded-lg bg-primary text-on-primary font-medium disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-400">{t('Add')}</button>
            </form>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="space-y-2">
            {agents.length === 0 && !issued && (
              <p className="text-sm text-gray-500">{t('No agents yet. Add one, then connect Claude Code, Codex, Cursor or any CLI agent with its token.')}</p>
            )}
            {agents.map((agent) => (
              <div key={agent.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800">
                <div className="w-9 h-9 rounded-[30%] avatar-tint-0 flex items-center justify-center shrink-0" aria-hidden>
                  <BotIcon />
                </div>
                <div className="flex-1 min-w-[8rem]">
                  <div className="text-sm font-semibold truncate">{agent.name}</div>
                  <div className="text-xs text-gray-500">{timeAgo(agent.lastUsedAt)}</div>
                </div>
                {/* Actions wrap under the name on narrow screens. */}
                <div className="flex items-center gap-1 ml-auto">
                  {agent.chatId && (
                    <button onClick={() => { onOpenChat(agent.chatId!); onClose(); }} className="text-xs font-medium text-primary-dark dark:text-primary px-2.5 py-1.5 rounded-lg hover:bg-primary/10">{t('Chat')}</button>
                  )}
                  <button onClick={() => rotate(agent)} className="text-xs text-gray-600 dark:text-gray-300 px-2.5 py-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700">{t('New token')}</button>
                  <button onClick={() => remove(agent)} className="text-xs text-gray-600 dark:text-gray-300 px-2.5 py-1.5 rounded-lg hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">{t('Delete')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenPanel({ issued, onDone }: { issued: Issued; onDone: () => void }) {
  const origin = window.location.origin;
  const download = `curl -fsSL ${origin}/zokul-agent.mjs -o zokul-agent.mjs`;
  // `connect` stores the token in ~/.zokul/config.json, so the MCP config
  // and scripts below contain no secret.
  const connect = `node zokul-agent.mjs connect ${origin} ${issued.token}`;
  const claude = `claude mcp add zokul -- node /full/path/to/zokul-agent.mjs mcp`;
  const cli = `node zokul-agent.mjs ask "Deploy to staging?" --options Yes,No`;

  return (
    <div className="space-y-3">
      <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-xs">
        Token for <b>{issued.agentName}</b>. Copy it now: it is shown only once. Anyone with it can post as this agent.
      </div>
      <CopyBlock label="Token" value={issued.token} />
      <CopyBlock label="1. Download the agent tool (Node 18+, no dependencies)" value={download} />
      <CopyBlock label="2. Connect it once on this computer" value={connect} />
      <CopyBlock label="3a. Claude Code (terminal) / any MCP client" value={claude} />
      <CopyBlock label="3b. Any agent or script (CLI)" value={cli} />
      <button onClick={onDone} className="w-full py-2 rounded-lg bg-primary text-on-primary font-medium">{t('Done')}</button>
    </div>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable: the text is selectable
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        <button onClick={copy} className="text-xs font-medium text-primary">{copied ? t('Copied ✓') : t('Copy')}</button>
      </div>
      <pre className="px-3 py-2 rounded-lg bg-gray-900 text-gray-100 text-[12px] whitespace-pre-wrap break-all select-all">{value}</pre>
    </div>
  );
}

export function BotIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4" /><circle cx="12" cy="3" r="1" />
      <circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none" />
      <path d="M2 13v3M22 13v3" />
    </svg>
  );
}
