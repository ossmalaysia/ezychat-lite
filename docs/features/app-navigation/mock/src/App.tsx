import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout } from './admin/AdminLayout';
import { ChangePasswordPage } from './auth/ChangePasswordPage';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { InboxPage } from './inbox/InboxPage';
import { SetupWizard } from './setup/SetupWizard';
import { ErrorBoundary } from '@/components/app/ErrorBoundary';
import { DesktopUpdateNotice } from '@/components/app/DesktopUpdates';
import { DevBuildBadge } from '@/components/app/DevBuildBadge';
// Proposed (app-navigation): rail + bottom tabs around every signed-in page; Ask Ezy opens from them.
import { AskEzyProvider } from './askezy/AskEzyContext';
import { AppShell } from './nav/AppNav';
import { AccountPage } from './nav/AccountPage';

export function App() {
  const { pathname } = useLocation();
  // A render crash shows an error panel (and is logged server-side) instead of a blank screen;
  // navigating to another route clears it.
  return (
    <ErrorBoundary resetKey={pathname}>
      <AskEzyProvider>
        <DesktopUpdateNotice />
        <DevBuildBadge />
        <Routes>
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<InboxPage />} />
              <Route path="/chats/:jid" element={<InboxPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route
                path="/admin/*"
                element={
                  <RequireAuth admin>
                    <AdminLayout />
                  </RequireAuth>
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AskEzyProvider>
    </ErrorBoundary>
  );
}

export default App;
