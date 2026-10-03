import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

it('groups concise sidebar support actions without changing their destinations', () => {
  render(<AppCredits variant="sidebar" />);
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
