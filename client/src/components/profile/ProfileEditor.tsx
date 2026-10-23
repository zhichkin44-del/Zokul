import { useState, useRef, FormEvent, ReactNode } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { User } from '../../types';
import Avatar from '../common/Avatar';
import Modal from '../common/Modal';
import { LanguageSwitch } from '../common/LanguageSwitch';
import { t } from '../../i18n';

interface ProfileEditorProps {
  open: boolean;
  onClose: () => void;
}

type ApiError = { response?: { data?: { error?: string } } };
const apiError = (err: unknown, fallback: string) => t((err as ApiError).response?.data?.error || fallback);
const input = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/40';
const label = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1';

export default function ProfileEditor({ open, onClose }: ProfileEditorProps) {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<{ url: string }>('/upload/avatar', form);
      const updated = await api.patch<User>('/users/profile', { avatarUrl: res.data.url });
      updateUser(updated.data);
    } catch (err: unknown) {
      setError(apiError(err, 'Failed to upload avatar'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('Name is required'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.patch<User>('/users/profile', { name: name.trim() });
      updateUser(res.data);
      onClose();
    } catch (err: unknown) {
      setError(apiError(err, 'Failed to update profile'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('Edit profile')}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <Avatar name={user?.name || '?'} size={72} url={user?.avatarUrl} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label={t('Change photo')}
            className="absolute bottom-0 right-0 bg-primary text-on-primary rounded-full w-6 h-6 text-xs flex items-center justify-center shadow-md disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-400"
          >
            +
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </div>
        {uploading && <p className="text-xs text-gray-500">{t('Uploading…')}</p>}
        <div className="w-full">
          <label htmlFor="profile-name" className={label}>{t('Name')}</label>
          <input id="profile-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={input} maxLength={100} />
        </div>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2 bg-primary text-on-primary rounded-xl text-sm font-medium disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-400"
        >
          {saving ? t('Saving…') : t('Save')}
        </button>

        <div className="w-full border-t border-gray-200 dark:border-gray-700 pt-3 flex items-center justify-between gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">{t('Language')}</span>
          <LanguageSwitch />
        </div>
        <Section title={t('Change password')}><ChangePassword /></Section>
        {user?.role !== 'admin' && <Section title={t('Delete account')} danger><DeleteAccount /></Section>}
      </div>
    </Modal>
  );
}

function Section({ title, danger, children }: { title: string; danger?: boolean; children: ReactNode }) {
  return (
    <details className="w-full border-t border-gray-200 dark:border-gray-700 pt-3 group">
      <summary className={`cursor-pointer list-none flex items-center justify-between text-sm ${danger ? 'text-red-700 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
        {title}
        <span aria-hidden="true" className="text-gray-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

// After a password change every session ends, this one included.
function ChangePassword() {
  const { logout } = useAuth();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { oldPassword, newPassword });
      window.alert(t('Password changed. Sign in again with the new password.'));
      await logout();
    } catch (err) {
      setError(apiError(err, 'Could not change the password'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="pw-old" className={label}>{t('Current password')}</label>
      <input id="pw-old" type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} className={input} required />
      <label htmlFor="pw-new" className={label}>{t('New password (8+ characters)')}</label>
      <input id="pw-new" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNew(e.target.value)} className={input} required />
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={busy} className="w-full py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">{t('Change password')}</button>
    </form>
  );
}

function DeleteAccount() {
  const { logout } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!window.confirm(t('Delete your account for good? This cannot be undone.'))) return;
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/delete-account', { password });
      await logout();
    } catch (err) {
      setError(apiError(err, 'Could not delete the account'));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <p className="text-xs text-gray-600 dark:text-gray-400">{t('Your name, email, photo and your AI agents are removed. Messages you sent stay in the chats as "Deleted account".')}</p>
      <label htmlFor="del-pw" className={label}>{t('Password to confirm')}</label>
      <input id="del-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} required />
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={busy} className="w-full py-2 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{t('Delete my account')}</button>
    </form>
  );
}
