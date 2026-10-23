import { useState, FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { t } from '../../i18n';
import { Field, errorText, primaryButton } from './Field';

export default function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // Joining is invite-only: the link from the admin carries ?invite=…
  const [params] = useSearchParams();
  const [invite, setInvite] = useState(params.get('invite') ?? '');
  const { register, loading } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError(t('Password must be at least 8 characters'));
      return;
    }
    try {
      await register(email, password, name, invite.trim() || undefined);
    } catch (err: unknown) {
      setError(t(errorText(err, 'Registration failed')));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-center text-sm text-gray-600 dark:text-gray-400 -mt-2 mb-2">{t('Zokul is invite-only. Use the link you were sent, or paste its code.')}</p>
      {error && <div role="alert" className="bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 p-3 rounded-xl text-sm">{error}</div>}
      <Field id="reg-invite" label={t('Invite code')} type="text" autoComplete="off" value={invite} onChange={(e) => setInvite(e.target.value)} className="font-mono text-sm" />
      <Field id="reg-name" label={t('Your name')} type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
      <Field id="reg-email" label={t('Email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Field id="reg-password" label={t('Password')} type="password" autoComplete="new-password" placeholder={t('At least 8 characters')} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      <button type="submit" disabled={loading} className={primaryButton}>
        {loading ? t('Creating account…') : t('Create account')}
      </button>
      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        {t('Already have an account?')}{' '}
        <Link to="/login" className="font-medium text-primary-dark dark:text-primary underline underline-offset-2">{t('Sign in')}</Link>
      </p>
    </form>
  );
}
