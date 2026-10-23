import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { ThemeProvider } from './contexts/ThemeContext';
import LoginForm from './components/auth/LoginForm';
import RegisterForm from './components/auth/RegisterForm';
import HomePage from './components/HomePage';
import AdminPage from './components/admin/AdminPage';
import { t, useLang } from './i18n';
import { LanguageSwitch } from './components/common/LanguageSwitch';
import ResetPasswordPage from './components/auth/ResetPasswordPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500">{t('Loading…')}</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 py-8 bg-gray-100 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-3xl bg-surface border border-gray-200 dark:border-gray-700 px-7 py-9 shadow-sm">
        <div className="text-center mb-8 select-none">
          <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-primary text-on-primary text-2xl font-semibold flex items-center justify-center" aria-hidden="true">Z</div>
          <h1 className="font-display text-4xl font-semibold text-gray-900 dark:text-gray-100">Zokul</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('People and AI agents, one workspace')}</p>
        </div>
        {children}
      </div>
      <LanguageSwitch />
    </main>
  );
}

export default function App() {
  // Changing the language re-mounts the app so every t() call re-renders.
  const lang = useLang();
  return (
    <BrowserRouter key={lang}>
      <AuthProvider>
        <ThemeProvider>
        <Routes>
          <Route path="/login" element={<PublicRoute><AuthLayout><LoginForm /></AuthLayout></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><AuthLayout><RegisterForm /></AuthLayout></PublicRoute>} />
          <Route path="/reset" element={<AuthLayout><ResetPasswordPage /></AuthLayout>} />
          <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
          <Route path="/*" element={
            <ProtectedRoute>
              <SocketProvider><HomePage /></SocketProvider>
            </ProtectedRoute>
          } />
        </Routes>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
