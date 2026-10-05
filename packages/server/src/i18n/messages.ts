import { createTranslator, type Catalog, type Locale } from '@wa-team-inbox/shared';

// Server-generated text shown to people (push notifications). API error messages stay English;
// the web app translates them by error code.
const en = {
  push: {
    newMessage: 'New message',
    unknownContact: 'Unknown contact',
    waLoggedOut: {
      title: 'WhatsApp disconnected',
      body: 'The linked number was logged out. Relink it from Admin > WhatsApp.',
    },
    waReplaced: {
      title: 'WhatsApp session replaced',
      body: 'Another device took over the session. Open Admin > WhatsApp to take it back.',
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
    waLoggedOut: {
      title: 'WhatsApp terputus',
      body: 'Nombor yang dipautkan telah dilog keluar. Pautkan semula di Admin > WhatsApp.',
    },
    waReplaced: {
      title: 'Sesi WhatsApp diganti',
      body: 'Peranti lain telah mengambil alih sesi. Buka Admin > WhatsApp untuk mengambilnya semula.',
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
    waLoggedOut: {
      title: 'WhatsApp 已断开',
      body: '已关联的号码已退出登录。请在 管理 > WhatsApp 中重新关联。',
    },
    waReplaced: {
      title: 'WhatsApp 会话已被替换',
      body: '另一台设备接管了此会话。打开 管理 > WhatsApp 以重新接管。',
    },
    waUnavailable: {
      title: 'WhatsApp 不可用',
      body: '连接状态：{{state}}',
    },
  },
};

export const serverCatalogs: Record<Locale, Catalog> = { en, ms, 'zh-CN': zhCN };

export const t = createTranslator(en, serverCatalogs);
