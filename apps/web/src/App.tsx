import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './admin/AdminLayout';
import { ChangePasswordPage } from './auth/ChangePasswordPage';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { InboxPage } from './inbox/InboxPage';
import { SetupWizard } from './setup/SetupWizard';

export function App() {
  return (
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
        <Route path="/" element={<InboxPage />} />
        <Route path="/chats/:jid" element={<InboxPage />} />
      </Route>
      <Route
        path="/admin/*"
        element={
          <RequireAuth admin>
            <AdminLayout />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
