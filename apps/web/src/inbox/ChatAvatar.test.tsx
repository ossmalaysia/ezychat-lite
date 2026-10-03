import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatAvatar } from './ChatAvatar';
import { ProfileImageContext } from './ProfileImageContext';

afterEach(cleanup);

it('shows initials while loading, displays a photo, and recovers when a different photo fails', () => {
  const view = render(<ChatAvatar name="Alex Chen" src="/api/photo/one" />);
  expect(screen.getByText('AC')).toBeTruthy();
  const image = view.container.querySelector('img')!;
  expect(image.getAttribute('loading')).toBe('lazy');
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
  fireEvent.load(image);
  expect(screen.queryByText('AC')).toBeNull();
  view.rerender(<ChatAvatar name="Alex Chen" src="/api/photo/two" />);
  fireEvent.error(view.container.querySelector('img')!);
  expect(screen.getByText('AC')).toBeTruthy();
  expect(view.container.querySelector('img')).toBeNull();
});

it('waits for WhatsApp readiness and retries a failed image after a new connection', () => {
  const src = '/api/chats/customer%40s.whatsapp.net/avatar';
  const photo = (ready: boolean, revision: number) => (
    <ProfileImageContext.Provider value={{ ready, revision }}>
      <ChatAvatar name="Alex Chen" src={src} />
    </ProfileImageContext.Provider>
  );
  const view = render(photo(false, 1));
  expect(view.container.querySelector('img')).toBeNull();
  view.rerender(photo(true, 2));
  expect(view.container.querySelector('img')!.getAttribute('src')).toBe(`${src}?connection=2`);
  fireEvent.error(view.container.querySelector('img')!);
  expect(view.container.querySelector('img')).toBeNull();
  view.rerender(photo(false, 2));
  view.rerender(photo(true, 3));
  const retry = view.container.querySelector('img')!;
  expect(retry.getAttribute('src')).toBe(`${src}?connection=3`);
  fireEvent.load(retry);
  expect(screen.queryByText('AC')).toBeNull();
});

it('does not repeat a private-photo lookup on ordinary re-renders', () => {
  const view = render(<ChatAvatar name="Alex Chen" src="/api/photo/private" />);
  fireEvent.error(view.container.querySelector('img')!);
  view.rerender(<ChatAvatar name="Alex Chen" src="/api/photo/private" />);
  expect(view.container.querySelector('img')).toBeNull();
  expect(screen.getByText('AC')).toBeTruthy();
});
