import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ChangePasswordPage } from './ChangePasswordPage';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 1, displayName: 'Ali', mustChangePassword: true },
    isLoading: false,
    logout: vi.fn(),
  }),
}));
vi.mock('../api/queries', () => ({
  useChangePassword: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock('@/lib/version', () => ({ useAppVersion: () => '0.1.0' }));
vi.mock('@/i18n/LanguageSelect', () => ({ LanguageSelect: () => null }));

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

it('keeps Save enabled and shows what is missing on submit', async () => {
  render(
    <MemoryRouter>
      <ChangePasswordPage />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const save = screen.getByRole('button', { name: 'Save password' }) as HTMLButtonElement;
  expect(save.disabled).toBe(false);
  await user.click(save);
  expect(mutate).not.toHaveBeenCalled();
  expect(screen.getByText('Required')).toBeTruthy();
  expect(screen.getByLabelText('New password').getAttribute('aria-invalid')).toBe('true');

  await user.type(screen.getByLabelText('Current password'), 'old-secret');
  await user.type(screen.getByLabelText('New password'), 'new-secret-1');
  await user.type(screen.getByLabelText('Confirm new password'), 'new-secret-1');
  await user.click(save);
  expect(mutate).toHaveBeenCalledWith(
    { currentPassword: 'old-secret', newPassword: 'new-secret-1' },
    expect.any(Object),
  );
});
