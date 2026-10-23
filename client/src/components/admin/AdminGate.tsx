import { useEffect, useRef, useState, FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { t } from '../../i18n';
import { glass, serif, field, primaryButton } from './style';

// The admin panel needs a second factor on top of the normal sign-in.
// The server is the judge (every admin request needs the unlock cookie);
// this gate only shows the right screen and hides the panel when locked.

type GateState = 'loading' | 'setup' | 'locked' | 'open';
type ApiError = { response?: { status?: number; data?: { error?: string; locked?: boolean } } };

const IDLE_MS = 15 * 60 * 1000;

export default function AdminGate({ children }: { children: (lock: () => void) => ReactNode }) {
  const [state, setState] = useState<GateState>('loading');
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    api.get<{ enabled: boolean; unlocked: boolean }>('/admin/2fa/status')
      .then((r) => setState(r.data.unlocked ? 'open' : r.data.enabled ? 'locked' : 'setup'))
      .catch(() => setState('locked'));

    // Any admin request answered with "locked" (idle timeout, session revoked)
    // hides the panel right away.
    const id = api.interceptors.response.use(
      (res) => {
        if (res.config.url?.startsWith('/admin/')) lastActivity.current = Date.now();
        return res;
      },
      (err: ApiError) => {
        if (err.response?.status === 401 && err.response.data?.locked) setState('locked');
        return Promise.reject(err);
      }
    );
    // Also lock the screen itself after the same idle time, so data does not
    // stay visible on an unattended computer.
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) setState((s) => (s === 'open' ? 'locked' : s));
    }, 30_000);
    return () => { api.interceptors.response.eject(id); window.clearInterval(timer); };
  }, []);

  const lock = () => {
    setState('locked');
    api.post('/admin/lock').catch(() => { /* the cookie is short-lived anyway */ });
  };
  const open = () => { lastActivity.current = Date.now(); setState('open'); };

  if (state === 'loading') return <main className="px-2 pt-6 text-sm text-[#A69DB6]">{t('Loading…')}</main>;
  if (state === 'setup') return <SetupScreen onDone={open} />;
  if (state === 'locked') return <UnlockScreen onDone={open} />;
  return <>{children(lock)}</>;
}

function Card({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return (
    <main className={`${glass} mx-auto mt-6 flex w-full max-w-md flex-col gap-4 px-6 py-6`}>
      <div>
        <div className="mb-1 text-xs text-[#A69DB6]">{eyebrow}</div>
        <h1 className="m-0 text-[26px] font-semibold tracking-[-0.01em]" style={serif}>{title}</h1>
      </div>
      {children}
      <Link to="/" className="text-center text-sm text-[#CFC3F0] hover:underline">← {t('Back to chats')}</Link>
    </main>
  );
}

function errorText(err: unknown, fallback: string) {
  return t((err as ApiError).response?.data?.error || fallback);
}

function CodeForm({ label, hint, submit, onDone, allowRecovery }: {
  label: string; hint?: string; submit: (code: string) => Promise<void>; onDone?: () => void; allowRecovery?: boolean;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await submit(code.trim());
      onDone?.();
    } catch (err) {
      setError(errorText(err, 'Wrong code'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-[#A69DB6]">{label}
        <input
          value={code}
          onChange={(e) => setCode(allowRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode={allowRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          maxLength={allowRecovery ? 9 : 6}
          placeholder="123456"
          className={`${field} text-center text-lg tracking-[0.3em]`}
        />
      </label>
      {hint && <p className="m-0 text-xs text-[#A69DB6]">{hint}</p>}
      {error && <p role="alert" className="m-0 text-sm text-[#EBC892]">{error}</p>}
      <button type="submit" disabled={busy || code.trim().length < 6} className={primaryButton}>{t('Continue')}</button>
    </form>
  );
}

function UnlockScreen({ onDone }: { onDone: () => void }) {
  return (
    <Card eyebrow={t('Admin panel is locked')} title={t('Enter the code')}>
      <p className="m-0 text-sm text-[#D8D1E3]">{t('Open your authenticator app and enter the 6-digit code for Zokul.')}</p>
      <CodeForm
        label={t('Code')}
        hint={t('Lost your phone? Enter one of your recovery codes instead (like abcd-efgh).')}
        allowRecovery
        submit={async (code) => { await api.post('/admin/2fa/unlock', { code }); }}
        onDone={onDone}
      />
    </Card>
  );
}

function SetupScreen({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setError('');
    try { setSetup((await api.post<{ secret: string; qr: string }>('/admin/2fa/setup')).data); }
    catch (err) { setError(errorText(err, 'Could not start the setup')); }
  };

  if (recovery) {
    const copy = async () => {
      try { await navigator.clipboard.writeText(recovery.join('\n')); setCopied(true); } catch { /* selectable */ }
    };
    return (
      <Card eyebrow={t('Two-factor sign-in is on')} title={t('Save your recovery codes')}>
        <p className="m-0 text-sm text-[#D8D1E3]">{t('If you lose your phone, each of these codes opens the panel once. They are shown only now. Keep them somewhere safe, away from this computer.')}</p>
        <ul className="m-0 grid list-none grid-cols-2 gap-2 rounded-xl border border-[#E8B97A]/25 bg-[#E8B97A]/[0.08] p-3">
          {recovery.map((c) => <li key={c} className="select-all text-center font-mono text-sm text-[#ECE7F2]">{c}</li>)}
        </ul>
        <button type="button" onClick={copy} className="self-start rounded-lg px-3 py-1.5 text-xs text-[#CFC3F0] hover:bg-white/[0.06]">{copied ? t('Copied ✓') : t('Copy all')}</button>
        <label className="flex items-center gap-2 text-sm text-[#D8D1E3]">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 accent-[#A99BD6]" />
          {t('I saved the codes')}
        </label>
        <button type="button" disabled={!saved} onClick={onDone} className={primaryButton}>{t('Open the panel')}</button>
      </Card>
    );
  }

  return (
    <Card eyebrow={t('One-time setup')} title={t('Protect the admin panel')}>
      <p className="m-0 text-sm text-[#D8D1E3]">{t('The panel opens only with a code from an authenticator app on your phone (Google Authenticator, Aegis, 2FAS or any other). Even with your password, nobody gets in without your phone.')}</p>
      {error && <p role="alert" className="m-0 text-sm text-[#EBC892]">{error}</p>}
      {!setup ? (
        <button type="button" onClick={start} className={primaryButton}>{t('Set up')}</button>
      ) : (
        <>
          <ol className="m-0 flex list-decimal flex-col gap-3 pl-5 text-sm text-[#D8D1E3]">
            <li>{t('In the app, add an account and scan this code.')}
              <img src={setup.qr} alt={t('QR code for the authenticator app')} width={180} height={180} className="mt-2 rounded-xl bg-white p-1.5" />
              <div className="mt-2 text-xs text-[#A69DB6]">{t('Cannot scan? Enter this key by hand:')}</div>
              <code className="select-all break-all text-[13px] tracking-wider text-[#ECE7F2]">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </li>
            <li>{t('Enter the 6-digit code the app shows.')}</li>
          </ol>
          <CodeForm
            label={t('Code')}
            submit={async (code) => { setRecovery((await api.post<{ recoveryCodes: string[] }>('/admin/2fa/enable', { code })).data.recoveryCodes); }}
          />
        </>
      )}
    </Card>
  );
}
