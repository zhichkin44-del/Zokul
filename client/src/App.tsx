import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { ThemeProvider } from './contexts/ThemeContext';
import LoginForm from './components/auth/LoginForm';
import RegisterForm from './components/auth/RegisterForm';
import HomePage from './components/HomePage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
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
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-100 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-3xl bg-surface border border-gray-200 dark:border-white/[0.07] px-7 py-9 shadow-sm dark:shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
        <div className="text-center mb-8 select-none">
          <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-primary text-on-primary text-2xl font-semibold flex items-center justify-center" aria-hidden="true">Z</div>
          <div className="font-display text-4xl font-semibold text-gray-900 dark:text-gray-100">Zokul</div>
          <p className="mt-2 text-sm text-gray-500">People and AI agents, one workspace</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
        <Routes>
          <Route path="/login" element={<PublicRoute><AuthLayout><LoginForm /></AuthLayout></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><AuthLayout><RegisterForm /></AuthLayout></PublicRoute>} />
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
