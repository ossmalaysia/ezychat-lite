import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppCredits } from './AppCredits';
import { ANCHOR_SPRINT_URL, CUSTOM_FEATURE_URL, GITHUB_ISSUES_URL } from '@/lib/links';

afterEach(cleanup);

it('preserves the attribution and contact wording outside the admin sidebar', () => {
  render(<AppCredits version="0.1.7" />);
  expect(screen.getByText('v0.1.7')).toBeTruthy();
  expect(screen.getByText(/Need a custom feature/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Contact Anchor Sprint' }).getAttribute('href')).toBe(
    CUSTOM_FEATURE_URL,
  );
});

it('folds sidebar support links into one Help & feedback item without changing destinations', async () => {
  render(<AppCredits variant="sidebar" version="0.1.7" />);
  expect(screen.getByText('v0.1.7')).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: 'Support links' })).toBeNull();
  const toggle = screen.getByRole('button', { name: 'Help & feedback' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await userEvent.setup().click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('navigation', { name: 'Support links' })).toBeTruthy();
  expect(screen.queryByText(/Need a custom feature/)).toBeNull();
  for (const [name, href] of [
    ['Anchor Sprint', ANCHOR_SPRINT_URL],
    ['Report an issue', GITHUB_ISSUES_URL],
    ['Custom features', CUSTOM_FEATURE_URL],
  ]) {
    const link = screen.getByRole('link', { name });
    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  }
});
