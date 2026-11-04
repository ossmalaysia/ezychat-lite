// Screen review and Dev Build check of the Claims agent template (docs/features/claims-template/design.md)
// against e2e/agents-devbuild.ts (mock model, fake WhatsApp, temp data). Start the runner with
// `--max-agents 2`, then: node e2e/claims-template-screens.mjs <baseURL> <outDir>
// Prints PASS/FAIL per check (a new agent from the template is Custom, group-only and has its Claim rules;
// an existing agent is never switched) and OVERFLOW / PAGEERROR lines; never calls a model.
import { ADMIN, VIEWS, screenKit } from './screen-kit.mjs';

const [base, out] = process.argv.slice(2);
if (!base || !out)
  throw new Error('Usage: node e2e/claims-template-screens.mjs <baseURL> <outDir>');
let failed = 0;
const check = (ok, step, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  (${detail})` : ''}`);
};

const { browser, ctx, api, adminContext, shot } = await screenKit(base, out);
const setup = await adminContext();
const req = setup.request;
// Agent 1 (Aina) answers direct chats with the untouched Sales starting text.
await api(req, 'PUT', '/api/ai', {
  displayName: 'Aina',
  enabled: false,
  instructions: '',
  handoffRules: '',
});
const aina = (await api(req, 'GET', '/api/ai')).agents[0];

const LOCALES = { en: 'en-US', ms: 'ms-MY', 'zh-CN': 'zh-CN' };
const NAMES = { en: 'Claims agent', ms: 'Ejen tuntutan', 'zh-CN': '理赔代理' };
const APPLY = { en: 'Apply template', ms: 'Gunakan templat', 'zh-CN': '应用模板' };
const BROWSE = { en: 'Browse templates', ms: 'Lihat templat', 'zh-CN': '浏览模板' };
const CREATE = { en: 'Create agent', ms: 'Cipta ejen', 'zh-CN': '创建代理' };

async function signIn(c) {
  const p = await c.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await c.request.fetch('/api/auth/login', {
    method: 'POST',
    data: { username: ADMIN.username, password: ADMIN.password },
    headers: { Origin: base },
  });
  return { p, errors };
}
async function applyClaims(p, lang) {
  const card = p.getByTestId('business-templates');
  await card.getByRole('button', { name: BROWSE[lang] }).click();
  const gallery = p.getByRole('dialog');
  await gallery.getByRole('radio', { name: NAMES[lang] }).click();
  await gallery.getByRole('button', { name: APPLY[lang] }).click();
  await gallery.waitFor({ state: 'hidden' });
}

let created = 0;
for (const lang of ['en', 'ms', 'zh-CN']) {
  for (const scheme of lang === 'en' ? ['light', 'dark'] : ['light']) {
    for (const [view, opts] of VIEWS) {
      const tag = `${lang}-${view}-${scheme}`;
      const c = await ctx({ ...opts, colorScheme: scheme, locale: LOCALES[lang] });
      const { p, errors } = await signIn(c);

      // Gallery: the Team and operations category with the Claims agent.
      await p.goto('/admin/members/ai/new?preset=custom');
      await p.getByTestId('business-templates').waitFor();
      if (lang === 'en') {
        await p.getByRole('button', { name: BROWSE.en }).click();
        await p.getByRole('dialog').getByRole('button', { name: 'Team and operations' }).click();
        await p.getByRole('dialog').getByRole('radio', { name: NAMES.en }).click();
        await shot(p, `01-gallery-${tag}`);
        await p.keyboard.press('Escape');
        await p.getByRole('dialog').waitFor({ state: 'hidden' });
      }

      // A new agent after Apply: filled texts and the group note.
      await applyClaims(p, lang);
      await p.getByTestId('group-setup').waitFor();
      await shot(p, `02-new-applied-${tag}`, true);

      // Create it once (English, desktop light): the Dev Build check of the defaults. It is deleted
      // again so the next new-agent page is not at the 2-agent limit.
      if (view === 'desktop' && scheme === 'light' && created < 1) {
        created++;
        await p.getByRole('button', { name: CREATE[lang] }).click();
        await p.waitForURL(/\/admin\/members\/ai\/\d+$/);
        const id = Number(/(\d+)$/.exec(p.url())[1]);
        await p.getByTestId('agent-direct').waitFor();
        await shot(p, `03-created-top-${tag}`);
        await p.getByTestId('agent-direct').scrollIntoViewIfNeeded();
        await shot(p, `04-created-switches-${tag}`);
        const agent = await api(c.request, 'GET', `/api/ai/agents/${id}`);
        const groups = await api(c.request, 'GET', `/api/ai/agents/${id}/groups`);
        check(agent.agent.preset === 'custom', 'the new agent is Custom', agent.agent.preset);
        check(
          agent.settings.instructions.startsWith('CLAIMS\n') &&
            !agent.settings.instructions.includes('Sales'),
          'its instructions are the claims text only',
        );
        check(
          agent.documents.some((d) => d.name === 'Claim rules'),
          'its Claim rules Business context item was added',
        );
        check(
          groups.enabled === true && groups.answerDirect === false,
          'it answers in groups only',
          JSON.stringify({ enabled: groups.enabled, answerDirect: groups.answerDirect }),
        );
        const first = await api(c.request, 'GET', `/api/ai/agents/${aina.id}/groups`);
        check(first.answerDirect === true, 'the other agent still answers direct chats');
        await api(c.request, 'DELETE', `/api/ai/agents/${id}`);
      }

      // The existing agent (Lite's only agent): a note, never a switch.
      await p.goto(`/admin/members/ai/${aina.id}`);
      await p.getByTestId('business-templates').waitFor();
      await applyClaims(p, lang);
      await p.getByTestId('group-setup').waitFor();
      await p.getByTestId('business-templates').scrollIntoViewIfNeeded();
      await shot(p, `05-existing-applied-${tag}`);
      if (errors.length) console.log(`PAGEERROR ${tag}: ${errors.join(' | ')}`);
      await c.close();
    }
  }
}
const after = await api(req, 'GET', `/api/ai/agents/${aina.id}/groups`);
check(
  after.answerDirect === true && after.enabled === false,
  'applying the template to an existing agent changed no switch',
);
await setup.close();
await browser.close();
console.log(failed ? `${failed} FAILED` : 'done');
process.exitCode = failed ? 1 : 0;
