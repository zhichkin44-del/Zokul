import { useCallback, useEffect, useState, FormEvent, ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatFileSize, formatLastSeen } from '../../utils/format';
import { t } from '../../i18n';

// Server administration in its own "glass lavender" look (fixed, not themed):
// muted violet glass over a warm, lamp-lit background.

interface Overview {
  people: number; peopleOnline: number; agents: number; openQuestions: number;
  messagesToday: number; agentMessagesToday: number; activeInvites: number; uploadsBytes: number;
}
interface Invite { id: string; label: string; maxUses: number; uses: number; expiresAt: string; state: 'active' | 'used' | 'expired' | 'revoked' }
interface AdminUser { id: string; name: string; email: string; role: 'admin' | 'user'; blocked: boolean; lastSeenAt?: string }
interface AdminAgent { id: string; name: string; ownerName: string; lastUsedAt?: string }
interface AuditEvent { id: string; at: string; action: string; actorName?: string; details?: Record<string, unknown> }
interface Health { database: boolean; redis: boolean; push: boolean }

type Section = 'overview' | 'invites' | 'users' | 'agents' | 'audit';
type ApiError = { response?: { data?: { error?: string } } };

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'invites', label: 'Invites' },
  { id: 'users', label: 'People' },
  { id: 'agents', label: 'Agents' },
  { id: 'audit', label: 'Activity log' },
];

const ACTION_TEXT: Record<string, string> = {
  login: 'signed in', login_failed: 'failed sign-in', login_blocked: 'blocked account tried to sign in',
  register: 'joined', password_changed: 'changed password', invite_created: 'created an invite',
  invite_revoked: 'revoked an invite', user_blocked: 'blocked a person', user_unblocked: 'unblocked a person',
  agent_created: 'added an agent', agent_token_rotated: 'issued a new agent token', agent_deleted: 'deleted an agent',
};
const WARN = new Set(['login_failed', 'login_blocked', 'user_blocked']);

const glass = 'rounded-[20px] border border-white/[0.08] bg-white/[0.045] backdrop-blur-xl';
const serif = { fontFamily: "'Source Serif 4', Georgia, serif" };

export default function AdminPage() {
  const { user } = useAuth();
  const [section, setSection] = useState<Section>('overview');
  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#1B1823] text-[#ECE7F2]">
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-40 h-[620px] w-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(150,128,200,0.30),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-52 -right-20 h-[640px] w-[640px] rounded-full bg-[radial-gradient(closest-side,rgba(232,185,122,0.16),transparent)]" />
      <div className="relative mx-auto flex max-w-6xl flex-wrap gap-4 p-4">
        <nav aria-label={t('Admin sections')} className={`${glass} flex w-full flex-col gap-1 p-3 md:w-56`}>
          <div className="flex items-center gap-2.5 px-2 pb-4 pt-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-[11px] border border-[#CFC3F0]/25 bg-[#A99BD6]/20 font-semibold text-[#E6DEFF]" style={serif}>Z</div>
            <div>
              <div className="text-[17px] font-semibold" style={serif}>Zokul</div>
              <div className="text-[11px] text-[#A69DB6]">{t('admin')}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 md:flex md:flex-col">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? 'page' : undefined}
                className={`rounded-xl px-3 py-2.5 text-center text-sm md:text-left ${section === s.id ? 'bg-[#CFC3F0]/[0.12] font-medium text-[#ECE7F2]' : 'text-[#C9C1D6] hover:bg-white/[0.04]'}`}
              >
                {t(s.label)}
              </button>
            ))}
          </div>
          <Link to="/" className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2.5 text-sm font-medium text-[#ECE7F2] hover:bg-white/[0.08] md:mt-auto">← {t('Back to chats')}</Link>
        </nav>
        <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          {section === 'overview' && <OverviewSection name={user.name} onGo={setSection} />}
          {section === 'invites' && <InvitesSection />}
          {section === 'users' && <UsersSection selfId={user.id} />}
          {section === 'agents' && <AgentsSection />}
          {section === 'audit' && <AuditSection />}
        </main>
      </div>
    </div>
  );
}

function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    api.get<T>(url).then((r) => setData(r.data)).catch((e: ApiError) => setError(e.response?.data?.error || 'Could not load'));
  }, [url]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Header({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 px-1.5 pt-2">
      <div>
        {eyebrow && <div className="mb-1 text-xs text-[#A69DB6]">{eyebrow}</div>}
        <h1 className="m-0 text-[30px] font-semibold tracking-[-0.01em]" style={serif}>{title}</h1>
      </div>
      {action}
    </header>
  );
}

function Stat({ label, value, note, warm }: { label: string; value: string | number; note?: string; warm?: boolean }) {
  return (
    <div className={`${glass} px-5 py-4`}>
      <div className="text-xs text-[#A69DB6]">{label}</div>
      <div className="mt-1 text-[30px] font-semibold" style={serif}>{value}</div>
      {note && <div className={`text-xs ${warm ? 'text-[#EBC892]' : 'text-[#A69DB6]'}`}>{note}</div>}
    </div>
  );
}

function OverviewSection({ name, onGo }: { name: string; onGo: (s: Section) => void }) {
  const { data } = useLoad<Overview>('/admin/overview');
  const { data: health } = useLoad<Health>('/admin/health');
  const { data: events } = useLoad<AuditEvent[]>('/admin/audit?limit=6');
  const calm = health ? health.database && health.redis : true;
  const hour = new Date().getHours();
  const greeting = t(hour < 6 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

  return (
    <>
      <Header eyebrow={`${greeting}, ${name}`} title={calm ? t('All quiet') : t('Needs attention')} action={
        <button onClick={() => onGo('invites')} className="h-10 rounded-[13px] border border-[#CFC3F0]/30 bg-[#A99BD6]/20 px-4 text-sm font-medium text-[#F1ECFA] hover:bg-[#A99BD6]/30">{t('Invite someone')}</button>
      } />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('People')} value={data?.people ?? '–'} note={data ? t('{n} online', { n: data.peopleOnline }) : undefined} />
        <Stat label={t('Agents')} value={data?.agents ?? '–'} note={data ? t('{n} waiting', { n: data.openQuestions }) : undefined} warm={(data?.openQuestions ?? 0) > 0} />
        <Stat label={t('Messages today')} value={data?.messagesToday ?? '–'} note={data ? t('{n} from agents', { n: data.agentMessagesToday }) : undefined} />
        <Stat label={t('Files')} value={data ? formatFileSize(data.uploadsBytes) : '–'} note={data ? t('{n} active invites', { n: data.activeInvites }) : undefined} />
      </div>
      <section className={`${glass} flex flex-col gap-1 px-5 py-4`}>
        <h2 className="mb-2 text-[19px] font-semibold" style={serif}>{t('Recent activity')}</h2>
        <EventList events={events ?? []} />
        {health && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip ok={health.database}>{t('Database')}</Chip>
            <Chip ok={health.redis}>Redis</Chip>
            <Chip ok={health.push}>Push</Chip>
          </div>
        )}
      </section>
    </>
  );
}

function Chip({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs ${ok ? 'bg-[#9FCB98]/[0.12] text-[#B9DDB3]' : 'bg-[#E8B97A]/[0.14] text-[#EBC892]'}`}>
      {children} {ok ? '✓' : '!'}
    </span>
  );
}

// Consecutive identical events (same person, same action) collapse into one
// row with a count, so routine sign-ins do not drown the important lines.
function collapse(events: AuditEvent[]): (AuditEvent & { count: number })[] {
  const rows: (AuditEvent & { count: number })[] = [];
  for (const e of events) {
    const prev = rows[rows.length - 1];
    if (prev && prev.action === e.action && prev.actorName === e.actorName && JSON.stringify(prev.details ?? {}) === JSON.stringify(e.details ?? {})) prev.count++;
    else rows.push({ ...e, count: 1 });
  }
  return rows;
}

function EventList({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-[#A69DB6]">{t('Nothing yet.')}</p>;
  return (
    <ul className="m-0 list-none p-0">
      {collapse(events).map((e) => {
        const subject = (e.details?.label ?? e.details?.name) as string | undefined;
        const showSubject = typeof subject === 'string' && subject !== e.actorName;
        return (
          <li key={e.id} className="flex gap-3 border-b border-white/[0.06] py-2 last:border-0">
            <span className="w-24 shrink-0 text-xs text-[#9C93AE]">{new Date(e.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            <span className={`text-[13px] ${WARN.has(e.action) ? 'text-[#EBC892]' : 'text-[#D8D1E3]'}`}>
              {e.actorName ?? t('Someone')} {t(ACTION_TEXT[e.action] ?? e.action)}
              {showSubject && <span className="text-[#A69DB6]"> · {subject}</span>}
              {e.count > 1 && <span className="ml-1.5 rounded-full bg-white/[0.07] px-1.5 text-[11px] text-[#A69DB6]">×{e.count}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function InvitesSection() {
  const { data, reload } = useLoad<Invite[]>('/admin/invites');
  const [label, setLabel] = useState('');
  const [uses, setUses] = useState(1);
  const [days, setDays] = useState(7);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post<{ code: string }>('/admin/invites', { label, maxUses: uses, expiresInDays: days });
      setLink(`${window.location.origin}/register?invite=${encodeURIComponent(res.data.code)}`);
      setLabel('');
      reload();
    } catch (err) {
      setError(t((err as ApiError).response?.data?.error || 'Could not create the invite'));
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* selectable */ }
  };

  const field = 'h-10 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 text-sm text-[#ECE7F2] placeholder:text-[#7F778F] focus:outline-none focus:ring-2 focus:ring-[#A99BD6]/50';
  const STATE: Record<Invite['state'], string> = { active: 'bg-[#E8B97A]/[0.14] text-[#EBC892]', used: 'bg-[#9FCB98]/[0.12] text-[#B9DDB3]', expired: 'bg-white/[0.06] text-[#A69DB6]', revoked: 'bg-white/[0.06] text-[#A69DB6]' };

  return (
    <>
      <Header title={t('Invites')} eyebrow={t('Only people with an invite can join this server')} />
      <form onSubmit={create} className={`${glass} flex flex-wrap items-end gap-3 px-5 py-4`}>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-[#A69DB6]">{t('For whom')}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('Bob, or the Site team')} maxLength={100} className={field} />
        </label>
        <label className="flex w-24 flex-col gap-1 text-xs text-[#A69DB6]">{t('Uses')}
          <input type="number" min={1} max={50} value={uses} onChange={(e) => setUses(Number(e.target.value))} className={field} />
        </label>
        <label className="flex w-24 flex-col gap-1 text-xs text-[#A69DB6]">{t('Days')}
          <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className={field} />
        </label>
        <button type="submit" className="h-10 rounded-[13px] border border-[#CFC3F0]/30 bg-[#A99BD6]/20 px-4 text-sm font-medium text-[#F1ECFA] hover:bg-[#A99BD6]/30">{t('Create invite')}</button>
        {error && <p className="w-full text-sm text-[#EBC892]">{error}</p>}
        {link && (
          <div className="w-full rounded-xl border border-[#E8B97A]/25 bg-[#E8B97A]/[0.08] p-3 text-sm">
            <div className="mb-2 text-xs text-[#EBC892]">{t('Send this link to the person. It is shown only once.')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 select-all break-all text-[12px] text-[#ECE7F2]">{link}</code>
              <button type="button" onClick={copy} className="rounded-lg px-3 py-1.5 text-xs text-[#CFC3F0] hover:bg-white/[0.06]">{copied ? t('Copied ✓') : t('Copy')}</button>
            </div>
          </div>
        )}
      </form>
      <section className={`${glass} flex flex-col gap-2 px-5 py-4`}>
        {(data ?? []).length === 0 && <p className="text-sm text-[#A69DB6]">{t('No invites yet.')}</p>}
        {(data ?? []).map((inv) => (
          <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-[14px] bg-white/[0.04] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className={`font-medium ${inv.state === 'active' ? '' : 'text-[#A69DB6]'}`}>{inv.label}</div>
              <div className="text-xs text-[#A69DB6]">{t('{used} of {max} used', { used: inv.uses, max: inv.maxUses })} · {t('until {date}', { date: new Date(inv.expiresAt).toLocaleDateString() })}</div>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs ${STATE[inv.state]}`}>{t(inv.state)}</span>
            {inv.state === 'active' && (
              <button onClick={() => api.delete(`/admin/invites/${inv.id}`).then(reload)} className="rounded-lg px-2 py-1 text-xs text-[#CFC3F0] hover:bg-white/[0.06]">{t('Revoke')}</button>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

function UsersSection({ selfId }: { selfId: string }) {
  const { data, reload } = useLoad<AdminUser[]>('/admin/users');
  const [error, setError] = useState('');
  const toggle = async (u: AdminUser) => {
    if (!u.blocked && !window.confirm(t('Block {name}? They are signed out everywhere right away.', { name: u.name }))) return;
    setError('');
    try {
      await api.post(`/admin/users/${u.id}/block`, { blocked: !u.blocked });
      reload();
    } catch (err) {
      setError((err as ApiError).response?.data?.error || 'Could not change');
    }
  };
  return (
    <>
      <Header title={t('People')} />
      <section className={`${glass} flex flex-col gap-2 px-5 py-4`}>
        {error && <p className="text-sm text-[#EBC892]">{error}</p>}
        {(data ?? []).map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-[14px] bg-white/[0.04] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{u.name}{u.id === selfId ? ` (${t('you')})` : ''}{u.role === 'admin' ? ` · ${t('admin')}` : ''}</div>
              <div className="truncate text-xs text-[#A69DB6]">{u.email} · {formatLastSeen(u.lastSeenAt)}</div>
            </div>
            {u.blocked && <span className="rounded-full bg-[#E8B97A]/[0.14] px-2.5 py-0.5 text-xs text-[#EBC892]">{t('blocked')}</span>}
            {u.role !== 'admin' && (
              <button onClick={() => toggle(u)} className="rounded-lg px-2 py-1 text-xs text-[#CFC3F0] hover:bg-white/[0.06]">{u.blocked ? t('Unblock') : t('Block')}</button>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

function AgentsSection() {
  const { data } = useLoad<AdminAgent[]>('/admin/agents');
  return (
    <>
      <Header title={t('Agents')} eyebrow={t('AI agents connected to this server, and who owns them')} />
      <section className={`${glass} flex flex-col gap-2 px-5 py-4`}>
        {(data ?? []).length === 0 && <p className="text-sm text-[#A69DB6]">{t('No agents yet.')}</p>}
        {(data ?? []).map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-[14px] bg-white/[0.04] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{a.name}</div>
              <div className="text-xs text-[#A69DB6]">{t('owner')}: {a.ownerName}</div>
            </div>
            <span className="text-xs text-[#A69DB6]">{a.lastUsedAt ? t('active {date}', { date: new Date(a.lastUsedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : t('never connected')}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function AuditSection() {
  const { data } = useLoad<AuditEvent[]>('/admin/audit?limit=100');
  return (
    <>
      <Header title={t('Activity log')} eyebrow={t('Sign-ins, invites, blocks and agent keys')} />
      <section className={`${glass} px-5 py-4`}>
        <EventList events={data ?? []} />
      </section>
    </>
  );
}
