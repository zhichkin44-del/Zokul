import { useEffect, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { t } from '../../i18n';
import { Field, errorText, primaryButton } from './Field';

// Opened from a one-time link the owner made: /reset#rst_…
// The token sits in the URL fragment, so it never reaches server logs.
export default function ResetPasswordPage() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [name, setName] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Drop the token from the address bar and history right away.
    window.history.replaceState(null, '', '/reset');
    api.post<{ name: string }>('/auth/reset/check', { token })
      .then((r) => setName(r.data.name))
      .catch(() => setInvalid(true));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== repeat) { setError(t('The passwords do not match')); return; }
    setBusy(true);
    try {
      await api.post('/auth/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(t(errorText(err, 'Could not change the password')));
    } finally {
      setBusy(false);
    }
  };

  const toLogin = <Link to="/login" className="block text-center font-medium text-primary-dark dark:text-primary underline underline-offset-2">{t('Go to sign in')}</Link>;

  if (done) return <div className="space-y-4 text-center"><p>{t('Password saved. Sign in with the new one.')}</p>{toLogin}</div>;
  if (invalid) {
    return (
      <div className="space-y-3 text-center">
        <p role="alert" className="font-medium">{t('This link is invalid or expired')}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('Ask the server owner for a new link.')}</p>
        {toLogin}
      </div>
    );
  }
  if (name === null) return <p className="text-center text-sm text-gray-600 dark:text-gray-400">{t('Checking the link…')}</p>;

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="font-display text-xl font-semibold text-center">{t('Set a new password')}</h2>
      <p className="text-center text-sm text-gray-600 dark:text-gray-400 -mt-2">{t('Hi, {name}. Choose a new password; you will be signed out on all devices.', { name })}</p>
      {error && <div role="alert" className="bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 p-3 rounded-xl text-sm">{error}</div>}
      <Field id="reset-password" label={t('New password')} type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <Field id="reset-repeat" label={t('Repeat the password')} type="password" autoComplete="new-password" minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
      <button type="submit" disabled={busy} className={primaryButton}>{t('Save the password')}</button>
    </form>
  );
}
