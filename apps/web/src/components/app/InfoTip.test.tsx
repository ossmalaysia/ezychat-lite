import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { activateLocale } from '@/i18n';
import { AppLinksProvider } from '@/lib/app-links';
import { resolveAppLinks } from '@/lib/links';
import { InfoTip } from './InfoTip';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

const open = async (name: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name }));
  return user;
};

describe('InfoTip with a core topic', () => {
  it('stays closed until clicked, then shows the short text and the actions', async () => {
    render(<InfoTip topic="apiKey" />);
    expect(screen.queryByText(/secret code that lets EzyChat use OpenAI/)).toBeNull();

    await open('What is an API key?');
    expect(screen.getByText(/secret code that lets EzyChat use OpenAI/)).toBeTruthy();
    const action = screen.getByRole('link', { name: 'Get a key at OpenAI' });
    expect(action.getAttribute('href')).toBe('https://platform.openai.com/api-keys');
    expect(action.getAttribute('target')).toBe('_blank');
    expect(action.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Full guide' }).getAttribute('href')).toBe(
      'https://ezychat.ai/guides/set-up-ai-agent?utm_source=ezychat-lite&utm_medium=app&utm_campaign=tip-apiKey',
    );
  });

  it('folds the steps until Show steps, and folds them again when reopened', async () => {
    render(<InfoTip topic="apiKey" />);
    const user = await open('What is an API key?');
    expect(screen.queryByText('Sign in at platform.openai.com.')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Show steps' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Sign in at platform.openai.com.',
      'Billing: add a card or credit.',
      'API keys → Create new secret key.',
      'Copy the key (sk-…) and paste it here.',
    ]);
    expect(screen.getByRole('button', { name: 'Hide steps' }).getAttribute('aria-expanded')).toBe(
      'true',
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByText(/secret code/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'What is an API key?' }));
    expect(screen.getByRole('button', { name: 'Show steps' })).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('shows only the text for a topic without steps, outside page or guide', async () => {
    render(<InfoTip topic="aiModel" />);
    await open('What is a model?');
    expect(screen.getByText(/The version of the AI/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show steps' })).toBeNull();
  });

  it('opens with the keyboard', async () => {
    render(<InfoTip topic="lan" />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('What is LAN access?');
    await user.keyboard('{Enter}');
    expect(screen.getByText(/same Wi-Fi/)).toBeTruthy();
  });

  it('links the guide in the app language', async () => {
    await activateLocale('zh-CN');
    render(<InfoTip topic="tunnel" />);
    await open('什么是手机访问？');
    expect(screen.getByRole('link', { name: '完整指南' }).getAttribute('href')).toBe(
      'https://ezychat.ai/zh/guides/connect-cloudflare?utm_source=ezychat-lite&utm_medium=app&utm_campaign=tip-tunnel',
    );
  });

  it("uses an edition's guide link, and hides it when the edition sets null", async () => {
    const { unmount } = render(
      <AppLinksProvider
        links={resolveAppLinks({
          guide: (guide, locale) => `https://ent.example/${locale}/${guide}`,
        })}
      >
        <InfoTip topic="mcp" />
      </AppLinksProvider>,
    );
    await open('What is AI assistant access?');
    expect(screen.getByRole('link', { name: 'Full guide' }).getAttribute('href')).toBe(
      'https://ent.example/en/connect-ai-assistant',
    );
    unmount();

    render(
      <AppLinksProvider links={resolveAppLinks({ guide: null })}>
        <InfoTip topic="mcp" />
      </AppLinksProvider>,
    );
    await open('What is AI assistant access?');
    expect(screen.queryByRole('link', { name: 'Full guide' })).toBeNull();
  });
});

describe('InfoTip with an edition’s own text', () => {
  it('shows the given title, body, steps and links', async () => {
    render(
      <InfoTip
        title="What is a phone number ID?"
        body="Meta's number for your WhatsApp line."
        steps={['Open API Setup.', 'Copy the Phone number ID.']}
        action={{ href: 'https://business.facebook.com', label: 'Open Meta' }}
        guideHref="https://ezychat.ai/guides/x"
      />,
    );
    const user = await open('What is a phone number ID?');
    expect(screen.getByText("Meta's number for your WhatsApp line.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Meta' }).getAttribute('href')).toBe(
      'https://business.facebook.com',
    );
    expect(screen.getByRole('link', { name: 'Full guide' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('drops links that are not https', async () => {
    render(
      <InfoTip
        title="What is X?"
        body="Body."
        action={{ href: 'javascript:alert(1)', label: 'Bad' }}
        guideHref="http://plain.example"
      />,
    );
    await open('What is X?');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
