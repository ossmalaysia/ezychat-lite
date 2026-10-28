import { createTranslator, type Catalog, type Locale } from '@ezychat/shared';

// Server-generated text shown to people (push notifications). API error messages stay English;
// the web app translates them by error code.
const en = {
  push: {
    newMessage: 'New message',
    unknownContact: 'Unknown contact',
    aiHandoff: { title: 'Chat handed over', body: '{{name}} needs a teammate.' },
    /** The AI handed a question in a WhatsApp group to the team. */
    aiGroupHandoff: {
      title: '{{agent}} needs you in {{group}}',
      body: '{{member}}: {{question}}',
      member: 'A member',
    },
    /** An alert about one of several linked numbers: the inbox name, then the alert. */
    inboxAlertTitle: '{{inbox}}: {{title}}',
    waLoggedOut: {
      title: 'WhatsApp disconnected',
      body: 'The linked number was logged out. Relink it from Admin > WhatsApp.',
      inboxBody: 'The linked number was logged out. Link it again from Admin > Inboxes.',
    },
    waReplaced: {
      title: 'WhatsApp session replaced',
      body: 'Another device took over the session. Open Admin > WhatsApp to take it back.',
      inboxBody: 'Another device took over the session. Open Admin > Inboxes to take it back.',
    },
    waUnavailable: {
      title: 'WhatsApp unavailable',
      body: 'Connection state: {{state}}',
    },
  },
};

const ms: typeof en = {
  push: {
    newMessage: 'Mesej baharu',
    unknownContact: 'Kenalan tidak dikenali',
    aiHandoff: { title: 'Sembang diserahkan', body: '{{name}} memerlukan bantuan ahli pasukan.' },
    aiGroupHandoff: {
      title: '{{agent}} memerlukan anda dalam {{group}}',
      body: '{{member}}: {{question}}',
      member: 'Seorang ahli',
    },
    inboxAlertTitle: '{{inbox}}: {{title}}',
    waLoggedOut: {
      title: 'WhatsApp terputus',
      body: 'Nombor yang dipautkan telah dilog keluar. Pautkan semula di Admin > WhatsApp.',
      inboxBody: 'Nombor yang dipautkan telah dilog keluar. Pautkan semula di Admin > Peti masuk.',
    },
    waReplaced: {
      title: 'Sesi WhatsApp diganti',
      body: 'Peranti lain telah mengambil alih sesi. Buka Admin > WhatsApp untuk mengambilnya semula.',
      inboxBody:
        'Peranti lain telah mengambil alih sesi. Buka Admin > Peti masuk untuk mengambilnya semula.',
    },
    waUnavailable: {
      title: 'WhatsApp tidak tersedia',
      body: 'Keadaan sambungan: {{state}}',
    },
  },
};

const zhCN: typeof en = {
  push: {
    newMessage: '新消息',
    unknownContact: '未知联系人',
    aiHandoff: { title: '会话已转交', body: '{{name}}需要团队成员协助。' },
    aiGroupHandoff: {
      title: '{{agent}} 需要你在 {{group}} 中协助',
      body: '{{member}}：{{question}}',
      member: '一位成员',
    },
    inboxAlertTitle: '{{inbox}}：{{title}}',
    waLoggedOut: {
      title: 'WhatsApp 已断开',
      body: '已关联的号码已退出登录。请在 管理 > WhatsApp 中重新关联。',
      inboxBody: '已关联的号码已退出登录。请在 管理 > 收件箱 中重新关联。',
    },
    waReplaced: {
      title: 'WhatsApp 会话已被替换',
      body: '另一台设备接管了此会话。打开 管理 > WhatsApp 以重新接管。',
      inboxBody: '另一台设备接管了此会话。打开 管理 > 收件箱 以重新接管。',
    },
    waUnavailable: {
      title: 'WhatsApp 不可用',
      body: '连接状态：{{state}}',
    },
  },
};

export const serverCatalogs: Record<Locale, Catalog> = { en, ms, 'zh-CN': zhCN };

export const t = createTranslator(en, serverCatalogs);
