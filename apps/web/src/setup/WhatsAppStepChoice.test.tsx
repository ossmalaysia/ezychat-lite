import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { qk } from '../api/queries';
import { registerExtensionCatalogs, WebExtensionsProvider, type WebExtension } from '../extensions';
import { WhatsAppStepChoice } from './WhatsAppStepChoice';

let connect: (() => void) | undefined;

const withSetup: WebExtension = {
  name: 'cloudsetup',
  inboxTypes: [
    {
      type: 'wa-cloud',
      labelKey: 'ext.cloudsetup.label',
      descriptionKey: 'ext.cloudsetup.description',
      CreateForm: () => null,
      SetupForm: ({ onConnected }) => {
        connect = onConnected;
        return <p data-testid="cloud-setup">paste your Meta details</p>;
      },
    },
  ],
  catalogs: {
    en: {
      'ext.cloudsetup.label': 'Business API',
      'ext.cloudsetup.description': 'Official Meta Cloud API.',
    },
  },
};
/** A type that cannot connect inbox 1 in the wizard (no SetupForm). */
const withoutSetup: WebExtension = {
  name: 'nosetup',
  inboxTypes: [
    {
      type: 'other',
      labelKey: 'ext.nosetup.l',
      descriptionKey: 'ext.nosetup.d',
      CreateForm: () => null,
    },
  ],
};

function show(extensions: WebExtension[]) {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const onContinue = vi.fn();
  const onSkip = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WebExtensionsProvider extensions={extensions}>
          <WhatsAppStepChoice
            phoneStep={<p data-testid="qr-step">scan the QR code</p>}
            onContinue={onContinue}
            onSkip={onSkip}
          />
        </WebExtensionsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidate, onContinue, onSkip, user: userEvent.setup() };
}

beforeAll(async () => {
  await registerExtensionCatalogs([withSetup]);
});
afterEach(() => {
  cleanup();
  connect = undefined;
});

describe('WhatsAppStepChoice', () => {
  it('is the QR step unchanged without a type that has a setup form (Lite)', () => {
    show([]);
    expect(screen.getByTestId('qr-step')).toBeTruthy();
    expect(screen.queryByTestId('wa-step-choice')).toBeNull();
    cleanup();
    show([withoutSetup]);
    expect(screen.getByTestId('qr-step')).toBeTruthy();
    expect(screen.queryByText('How do you connect WhatsApp?')).toBeNull();
  });

  it('offers the QR scan first and by default, then the type with its setup form', async () => {
    const { user, onSkip, onContinue, invalidate } = show([withSetup]);
    expect(screen.getByText('How do you connect WhatsApp?')).toBeTruthy();
    const qr = screen.getByRole('radio', { name: 'WhatsApp app (QR)' });
    const api = screen.getByRole('radio', { name: 'Business API' });
    expect(qr.getAttribute('aria-checked')).toBe('true');
    expect(api.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('qr-step')).toBeTruthy();
    expect(screen.getByText('Scan a QR code with the WhatsApp app on the phone.')).toBeTruthy();

    await user.click(api);
    expect(screen.queryByTestId('qr-step')).toBeNull();
    expect(screen.getByTestId('cloud-setup')).toBeTruthy();
    expect(screen.getByText('Official Meta Cloud API.')).toBeTruthy();
    const next = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledOnce();

    act(() => connect!());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.inboxes });
    expect(next.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    await user.click(next);
    expect(onContinue).toHaveBeenCalledOnce();

    // Back to the QR scan: the phone step returns.
    await user.click(qr);
    expect(screen.getByTestId('qr-step')).toBeTruthy();
  });
});
