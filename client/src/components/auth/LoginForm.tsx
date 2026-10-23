import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { t } from '../../i18n';
import { Field, errorText, primaryButton } from './Field';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, loading } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
    } catch (err: unknown) {
      setError(t(errorText(err, 'Login failed')));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-center text-sm text-gray-600 dark:text-gray-400 -mt-2 mb-2">{t('Sign in to your workspace')}</p>
      {error && <div role="alert" className="bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 p-3 rounded-xl text-sm">{error}</div>}
      <Field id="login-email" label={t('Email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Field id="login-password" label={t('Password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button type="submit" disabled={loading} className={primaryButton}>
        {loading ? t('Signing in…') : t('Sign in')}
      </button>
      <p className="text-center text-xs text-gray-500 dark:text-gray-400">{t('Forgot your password? Ask the server owner for a reset link.')}</p>
      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        {t('No account?')}{' '}
        <Link to="/register" className="font-medium text-primary-dark dark:text-primary underline underline-offset-2">{t('Join with an invite')}</Link>
      </p>
    </form>
  );
}
