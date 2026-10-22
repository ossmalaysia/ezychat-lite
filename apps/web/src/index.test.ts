import { describe, expect, it, vi } from 'vitest';

vi.mock('./create-app', () => ({ createInboxApp: vi.fn() }));

describe('public web entry', () => {
  it('exports the app factory, extension API and UI building blocks', async () => {
    const api = await import('./index');
    for (const name of [
      'createInboxApp',
      'validateWebExtensions',
      'WEB_EXTENSION_ADMIN_SECTIONS',
      'useExtensionTranslation',
      'useAgentSection',
      'useTranslation',
      'useAuth',
      'api',
      'Button',
      'Card',
      'CardHeader',
      'Input',
      'Switch',
      'Dialog',
      'Badge',
      'PageHeader',
      'EmptyState',
      'Banner',
      'ErrorBoundary',
    ]) {
      expect(api, name).toHaveProperty(name);
    }
  }, 30_000);
});
