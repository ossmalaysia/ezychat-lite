import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { ConnectorDetailPage } from './ConnectorDetailPage';
import { ConnectorsGalleryPage } from './ConnectorsGalleryPage';
import {
  DEFAULT_LIST,
  entry,
  gallery,
  listed,
  renderAt,
  stubServer,
  world,
} from './connectors.test.helpers';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const NOTICE = { en: 'Google is still reviewing this connector.' };

/** The default list with Google Calendar marked Beta (and a notice), plus one Beta partner. */
function betaWorld({ calendarBeta = true } = {}) {
  const [calendar, ...rest] = DEFAULT_LIST;
  return world({
    gallery: gallery([
      calendarBeta
        ? { ...calendar!, entry: { ...calendar!.entry, stage: 'beta', notice: NOTICE } }
        : calendar!,
      ...rest,
      listed(
        entry('lejar', {
          name: 'Lejar',
          stage: 'beta',
          notice: { en: 'Lejar is new: tell us what does not work.' },
        }),
      ),
    ]),
  });
}

describe('Beta connectors (marked by the connector list)', () => {
  it('shows Beta on the gallery cards the list marks, and only there', async () => {
    stubServer(betaWorld());
    renderAt('/admin/connectors', <ConnectorsGalleryPage />, { route: '/admin/connectors' });
    const lejar = await screen.findByTestId('connector-card-lejar');
    expect(within(lejar).getByTestId('connector-beta').textContent).toBe('Beta');
    expect(
      within(screen.getByTestId('connector-card-google-calendar')).getByTestId('connector-beta'),
    ).toBeTruthy();
    expect(within(screen.getByTestId('connector-card-xero')).queryByTestId('connector-beta')).toBe(
      null,
    );
  });

  it('shows no Beta for Google Calendar once the list drops the mark', async () => {
    stubServer(betaWorld({ calendarBeta: false }));
    renderAt('/admin/connectors', <ConnectorsGalleryPage />, { route: '/admin/connectors' });
    await screen.findByTestId('connector-card-lejar');
    expect(
      within(screen.getByTestId('connector-card-google-calendar')).queryByTestId('connector-beta'),
    ).toBe(null);
  });

  it('Google Calendar page: Beta in the header and the notice above the Google account', async () => {
    stubServer(betaWorld());
    renderAt('/admin/connectors/google-calendar', <ConnectorDetailPage />);
    const notice = await screen.findByTestId('connector-notice');
    expect(notice.textContent).toBe(NOTICE.en);
    expect(screen.getByTestId('connector-beta')).toBeTruthy();
    // The notice comes before the Google account card (above Connect).
    const account = screen.getByTestId('google-calendar-account');
    expect(notice.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('partner page: Beta in the header and the entry notice', async () => {
    stubServer(betaWorld());
    renderAt('/admin/connectors/lejar', <ConnectorDetailPage />);
    expect((await screen.findByTestId('connector-notice')).textContent).toBe(
      'Lejar is new: tell us what does not work.',
    );
    expect(screen.getByTestId('connector-beta')).toBeTruthy();
  });
});
