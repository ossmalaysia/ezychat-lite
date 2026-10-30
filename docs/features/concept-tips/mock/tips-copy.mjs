// The concept-tips copy (en, ms, zh-CN) merged into src/i18n/locales/<lang>/common.json under `mockTips`.
// Usage: node docs/features/concept-tips/mock/tips-copy.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const en = {
  guide: 'Read the full guide',
  whatsappLink: {
    title: 'How does linking WhatsApp work?',
    body: 'EzyChat joins your WhatsApp as a linked device, the same way WhatsApp Web does. Your phone keeps the number and keeps working; your team replies from EzyChat. Only the last few days of chat history come in.',
    note: 'Open WhatsApp on the phone at least once every 14 days, or WhatsApp signs the linked device out.',
  },
  aiConnection: {
    title: 'Why does the AI need a connection?',
    body: 'EzyChat has no AI of its own. It uses ChatGPT or Claude through your own account, so the messages go straight to that service and you control the cost.',
    stepsTitle: 'Three ways to connect',
    step1: 'Sign in with ChatGPT: the easiest. Uses your ChatGPT plan, no key to copy.',
    step2: 'OpenAI API key: pay OpenAI for what the AI uses.',
    step3: 'Claude API key: pay Anthropic for what the AI uses.',
    note: 'Not sure? Start with Sign in with ChatGPT. You can switch later; your AI setup stays.',
  },
  apiKey: {
    title: 'What is an API key?',
    body: 'A long secret code, like a password, that lets EzyChat use OpenAI on your account. OpenAI bills that account for what the AI uses (pay as you go, separate from a ChatGPT Plus plan).',
    stepsTitle: 'How to get one',
    step1: 'Go to platform.openai.com and sign in, or create an account.',
    step2: 'Open Settings → Billing and add a payment method or credit.',
    step3: 'Open API keys → Create new secret key. Name it EzyChat.',
    step4: 'Copy the key (it starts with sk-) and paste it here. OpenAI shows it only once.',
    note: 'Keep it private like a password. EzyChat stores it encrypted on this computer. No key? Use Sign in with ChatGPT instead.',
    action: 'Open OpenAI API keys',
  },
  claudeKey: {
    title: 'What is a Claude API key?',
    body: 'A long secret code, like a password, that lets EzyChat use Claude on your Anthropic account. Anthropic bills that account for what the AI uses (pay as you go, separate from a Claude Pro plan).',
    stepsTitle: 'How to get one',
    step1: 'Go to console.anthropic.com and sign in, or create an account.',
    step2: 'Open Settings → Billing and add credit.',
    step3: 'Open API keys → Create key. Name it EzyChat.',
    step4: 'Copy the key (it starts with sk-ant-) and paste it here. Anthropic shows it only once.',
    note: 'Keep it private like a password. EzyChat stores it encrypted on this computer.',
    action: 'Open Anthropic API keys',
  },
  aiModel: {
    title: 'What is a model?',
    body: 'The model is the version of the AI. Larger models write better answers but are slower and cost more per message; smaller ones are fast and cheap.',
    note: 'Keep the recommended choice unless you have a reason to change it.',
  },
  businessContext: {
    title: 'What is Business context?',
    body: 'What the AI knows about your business: products, prices, opening hours, delivery areas, policies and common questions. The AI answers only from this; when something is missing, it hands the chat to your team.',
    stepsTitle: 'Tips',
    step1: 'Paste your price list, menu or FAQ as text, or upload a PDF or Word file.',
    step2: 'Write it the way you would brief a new staff member.',
    step3: 'Update it when prices or hours change.',
  },
  instructions: {
    title: 'What is the role?',
    body: 'The role tells the AI how to behave: its tone, language, what to ask customers and what to avoid. Think of it as the job description of your AI staff.',
    note: 'Facts like prices and hours go in Business context, not here.',
  },
  handoff: {
    title: 'What is a hand-over?',
    body: 'A hand-over is when the AI stops and passes the chat to a person on your team, who gets a notification. Hand-over rules list when that must happen, for example complaints, refunds or custom orders.',
    note: 'The customer is told a team member will reply. Anyone on the team can also take over a chat at any time.',
  },
  tryIt: {
    title: 'What is Try it?',
    body: 'A practice chat. Type what a customer might say and see how the AI would answer. Nothing is sent to WhatsApp and no chat changes.',
  },
  voice: {
    title: 'What is voice note transcription?',
    body: "It turns customers' voice notes into text, so the AI and your team can read them.",
    stepsTitle: 'Two ways',
    step1: 'On this computer: a one-time download, free, and the audio never leaves the computer.',
    step2: 'In the cloud: faster, uses your OpenAI API key and is billed by OpenAI.',
    note: 'Without either, voice notes still arrive; the AI hands them to your team.',
  },
  tunnel: {
    title: 'What is phone access?',
    body: 'EzyChat runs on this computer. Phone access gives it a secure web address through Cloudflare (a free service), so your team can open the inbox on their phones from anywhere. This link is called a tunnel.',
    note: 'The address works only while this computer is on and EzyChat is running.',
  },
  lan: {
    title: 'What is LAN access?',
    body: 'It lets phones and computers on the same Wi-Fi or office network open the inbox, without going through the internet.',
    note: 'LAN traffic is not encrypted. Turn it on only on a network you trust; use phone access for anywhere else.',
  },
  mcp: {
    title: 'What is AI assistant access?',
    body: 'It lets an AI app you already use, like Claude or ChatGPT, read your inbox and help you: summarise chats, check numbers, improve your AI agent. MCP is the standard these apps use to connect to other tools.',
    note: 'It stays off until you turn it on, and you choose what each app may do.',
  },
  accessToken: {
    title: 'What is an access token?',
    body: 'A secret code that a developer tool on your computer uses to prove it may use your inbox. Apps like claude.ai and ChatGPT sign in by themselves and need no token.',
    note: 'Copy it once and keep it private. Revoke it here to cut access at once.',
  },
  connectors: {
    title: 'What is a connector?',
    body: 'A connector lets your AI agent use another app for you, for example check free times in Google Calendar and book an appointment.',
    note: 'Look-ups are on once connected; anything that changes data stays off until you turn it on.',
  },
};

const ms = {
  guide: 'Baca panduan penuh',
  whatsappLink: {
    title: 'Bagaimana WhatsApp dipautkan?',
    body: 'EzyChat menyertai WhatsApp anda sebagai peranti dipaut, sama seperti WhatsApp Web. Telefon anda kekal memegang nombor itu dan terus berfungsi; pasukan anda membalas dari EzyChat. Hanya sejarah chat beberapa hari terakhir dibawa masuk.',
    note: 'Buka WhatsApp di telefon sekurang-kurangnya sekali setiap 14 hari, jika tidak WhatsApp akan log keluar peranti dipaut.',
  },
  aiConnection: {
    title: 'Kenapa AI perlu disambungkan?',
    body: 'EzyChat tiada AI sendiri. Ia menggunakan ChatGPT atau Claude melalui akaun anda sendiri, jadi mesej terus ke perkhidmatan itu dan anda mengawal kosnya.',
    stepsTitle: 'Tiga cara menyambung',
    step1:
      'Log masuk dengan ChatGPT: paling mudah. Guna pelan ChatGPT anda, tiada kunci untuk disalin.',
    step2: 'Kunci API OpenAI: bayar OpenAI mengikut penggunaan AI.',
    step3: 'Kunci API Claude: bayar Anthropic mengikut penggunaan AI.',
    note: 'Tidak pasti? Mula dengan Log masuk dengan ChatGPT. Anda boleh tukar kemudian; tetapan AI anda kekal.',
  },
  apiKey: {
    title: 'Apakah kunci API?',
    body: 'Kod rahsia yang panjang, seperti kata laluan, yang membolehkan EzyChat menggunakan OpenAI pada akaun anda. OpenAI mengebil akaun itu mengikut penggunaan AI (bayar ikut guna, berasingan daripada pelan ChatGPT Plus).',
    stepsTitle: 'Cara mendapatkannya',
    step1: 'Pergi ke platform.openai.com dan log masuk, atau buat akaun.',
    step2: 'Buka Settings → Billing dan tambah kaedah pembayaran atau kredit.',
    step3: 'Buka API keys → Create new secret key. Namakan EzyChat.',
    step4:
      'Salin kunci itu (bermula dengan sk-) dan tampal di sini. OpenAI memaparkannya sekali sahaja.',
    note: 'Simpan secara rahsia seperti kata laluan. EzyChat menyimpannya secara tersulit pada komputer ini. Tiada kunci? Guna Log masuk dengan ChatGPT.',
    action: 'Buka kunci API OpenAI',
  },
  claudeKey: {
    title: 'Apakah kunci API Claude?',
    body: 'Kod rahsia yang panjang, seperti kata laluan, yang membolehkan EzyChat menggunakan Claude pada akaun Anthropic anda. Anthropic mengebil akaun itu mengikut penggunaan AI (bayar ikut guna, berasingan daripada pelan Claude Pro).',
    stepsTitle: 'Cara mendapatkannya',
    step1: 'Pergi ke console.anthropic.com dan log masuk, atau buat akaun.',
    step2: 'Buka Settings → Billing dan tambah kredit.',
    step3: 'Buka API keys → Create key. Namakan EzyChat.',
    step4:
      'Salin kunci itu (bermula dengan sk-ant-) dan tampal di sini. Anthropic memaparkannya sekali sahaja.',
    note: 'Simpan secara rahsia seperti kata laluan. EzyChat menyimpannya secara tersulit pada komputer ini.',
    action: 'Buka kunci API Anthropic',
  },
  aiModel: {
    title: 'Apakah model?',
    body: 'Model ialah versi AI. Model besar menulis jawapan lebih baik tetapi lebih perlahan dan lebih mahal bagi setiap mesej; model kecil pantas dan murah.',
    note: 'Kekalkan pilihan yang disyorkan melainkan anda ada sebab untuk menukarnya.',
  },
  businessContext: {
    title: 'Apakah Konteks perniagaan?',
    body: 'Apa yang AI tahu tentang perniagaan anda: produk, harga, waktu operasi, kawasan penghantaran, polisi dan soalan lazim. AI menjawab hanya daripada ini; jika sesuatu tiada, ia menyerahkan chat kepada pasukan anda.',
    stepsTitle: 'Petua',
    step1: 'Tampal senarai harga, menu atau FAQ sebagai teks, atau muat naik fail PDF atau Word.',
    step2: 'Tulis seperti anda memberi taklimat kepada pekerja baharu.',
    step3: 'Kemas kini apabila harga atau waktu berubah.',
  },
  instructions: {
    title: 'Apakah peranan?',
    body: 'Peranan memberitahu AI cara berkelakuan: nada, bahasa, apa yang perlu ditanya kepada pelanggan dan apa yang perlu dielakkan. Anggaplah ia sebagai huraian kerja pekerja AI anda.',
    note: 'Fakta seperti harga dan waktu dimasukkan dalam Konteks perniagaan, bukan di sini.',
  },
  handoff: {
    title: 'Apakah serahan?',
    body: 'Serahan ialah apabila AI berhenti dan menyerahkan chat kepada seorang ahli pasukan anda, yang menerima pemberitahuan. Peraturan serahan menyenaraikan bila ia mesti berlaku, contohnya aduan, bayaran balik atau tempahan khas.',
    note: 'Pelanggan diberitahu ahli pasukan akan membalas. Sesiapa dalam pasukan juga boleh mengambil alih chat pada bila-bila masa.',
  },
  tryIt: {
    title: 'Apakah Cuba?',
    body: 'Chat latihan. Taip apa yang mungkin dikatakan pelanggan dan lihat bagaimana AI akan menjawab. Tiada apa dihantar ke WhatsApp dan tiada chat berubah.',
  },
  voice: {
    title: 'Apakah transkripsi nota suara?',
    body: 'Ia menukar nota suara pelanggan kepada teks, supaya AI dan pasukan anda boleh membacanya.',
    stepsTitle: 'Dua cara',
    step1:
      'Pada komputer ini: muat turun sekali, percuma, dan audio tidak pernah keluar dari komputer.',
    step2: 'Di awan: lebih pantas, menggunakan kunci API OpenAI anda dan dibilkan oleh OpenAI.',
    note: 'Tanpa kedua-duanya, nota suara tetap diterima; AI menyerahkannya kepada pasukan anda.',
  },
  tunnel: {
    title: 'Apakah akses telefon?',
    body: 'EzyChat berjalan pada komputer ini. Akses telefon memberikannya alamat web yang selamat melalui Cloudflare (perkhidmatan percuma), supaya pasukan anda boleh membuka peti masuk di telefon dari mana-mana. Pautan ini dipanggil terowong.',
    note: 'Alamat itu berfungsi hanya semasa komputer ini hidup dan EzyChat berjalan.',
  },
  lan: {
    title: 'Apakah akses LAN?',
    body: 'Ia membolehkan telefon dan komputer pada Wi-Fi atau rangkaian pejabat yang sama membuka peti masuk, tanpa melalui internet.',
    note: 'Trafik LAN tidak disulitkan. Hidupkan hanya pada rangkaian yang anda percayai; guna akses telefon untuk tempat lain.',
  },
  mcp: {
    title: 'Apakah akses pembantu AI?',
    body: 'Ia membolehkan aplikasi AI yang anda sudah guna, seperti Claude atau ChatGPT, membaca peti masuk anda dan membantu: meringkaskan chat, menyemak angka, menambah baik ejen AI anda. MCP ialah piawaian yang digunakan aplikasi ini untuk bersambung dengan alat lain.',
    note: 'Ia kekal dimatikan sehingga anda menghidupkannya, dan anda memilih apa yang boleh dilakukan setiap aplikasi.',
  },
  accessToken: {
    title: 'Apakah token akses?',
    body: 'Kod rahsia yang digunakan alat pembangun pada komputer anda untuk membuktikan ia boleh menggunakan peti masuk anda. Aplikasi seperti claude.ai dan ChatGPT log masuk sendiri dan tidak perlukan token.',
    note: 'Salin sekali dan simpan secara rahsia. Batalkan di sini untuk memutuskan akses serta-merta.',
  },
  connectors: {
    title: 'Apakah penyambung?',
    body: 'Penyambung membolehkan ejen AI anda menggunakan aplikasi lain untuk anda, contohnya menyemak masa lapang dalam Google Calendar dan membuat temu janji.',
    note: 'Carian dihidupkan sebaik disambungkan; apa-apa yang mengubah data kekal dimatikan sehingga anda menghidupkannya.',
  },
};

const zh = {
  guide: '阅读完整指南',
  whatsappLink: {
    title: '如何连接 WhatsApp？',
    body: 'EzyChat 以“关联设备”的方式加入您的 WhatsApp，和 WhatsApp Web 一样。号码仍在您的手机上，手机照常使用；团队在 EzyChat 里回复。只会导入最近几天的聊天记录。',
    note: '请至少每 14 天在手机上打开一次 WhatsApp，否则 WhatsApp 会让关联设备退出登录。',
  },
  aiConnection: {
    title: '为什么 AI 需要连接？',
    body: 'EzyChat 本身没有 AI。它通过您自己的账号使用 ChatGPT 或 Claude，消息直接发到该服务，费用由您掌控。',
    stepsTitle: '三种连接方式',
    step1: '用 ChatGPT 登录：最简单，使用您的 ChatGPT 套餐，无需复制密钥。',
    step2: 'OpenAI API 密钥：按 AI 用量向 OpenAI 付费。',
    step3: 'Claude API 密钥：按 AI 用量向 Anthropic 付费。',
    note: '不确定？先用 ChatGPT 登录。之后可以随时更换，AI 设置会保留。',
  },
  apiKey: {
    title: '什么是 API 密钥？',
    body: '一串很长的秘密代码，像密码一样，让 EzyChat 用您的账号使用 OpenAI。OpenAI 按 AI 用量向该账号收费（按用量付费，与 ChatGPT Plus 套餐分开）。',
    stepsTitle: '获取方法',
    step1: '前往 platform.openai.com 登录，或注册账号。',
    step2: '打开 Settings → Billing，添加付款方式或充值。',
    step3: '打开 API keys → Create new secret key，命名为 EzyChat。',
    step4: '复制密钥（以 sk- 开头）并粘贴到这里。OpenAI 只显示一次。',
    note: '像密码一样保密。EzyChat 会加密保存在这台电脑上。没有密钥？改用 ChatGPT 登录。',
    action: '打开 OpenAI API 密钥页面',
  },
  claudeKey: {
    title: '什么是 Claude API 密钥？',
    body: '一串很长的秘密代码，像密码一样，让 EzyChat 用您的 Anthropic 账号使用 Claude。Anthropic 按 AI 用量向该账号收费（按用量付费，与 Claude Pro 套餐分开）。',
    stepsTitle: '获取方法',
    step1: '前往 console.anthropic.com 登录，或注册账号。',
    step2: '打开 Settings → Billing 并充值。',
    step3: '打开 API keys → Create key，命名为 EzyChat。',
    step4: '复制密钥（以 sk-ant- 开头）并粘贴到这里。Anthropic 只显示一次。',
    note: '像密码一样保密。EzyChat 会加密保存在这台电脑上。',
    action: '打开 Anthropic API 密钥页面',
  },
  aiModel: {
    title: '什么是模型？',
    body: '模型就是 AI 的版本。大模型回答更好，但更慢、每条消息更贵；小模型快又便宜。',
    note: '除非有特别原因，请保留推荐的选项。',
  },
  businessContext: {
    title: '什么是业务资料？',
    body: 'AI 对您生意的了解：产品、价格、营业时间、送货范围、政策和常见问题。AI 只根据这些回答；缺少的内容会转交给您的团队。',
    stepsTitle: '小贴士',
    step1: '把价目表、菜单或常见问题以文字粘贴，或上传 PDF、Word 文件。',
    step2: '像给新员工做介绍那样写。',
    step3: '价格或营业时间有变时记得更新。',
  },
  instructions: {
    title: '什么是角色？',
    body: '角色告诉 AI 应该怎样表现：语气、语言、要问客户什么、要避免什么。可以把它当作 AI 员工的工作说明。',
    note: '价格、营业时间等事实请放在业务资料里，而不是这里。',
  },
  handoff: {
    title: '什么是转交？',
    body: '转交是指 AI 停下，把聊天交给团队中的一位同事，同事会收到通知。转交规则列出必须转交的情况，例如投诉、退款或定制订单。',
    note: '客户会被告知团队成员将回复。团队任何人也可以随时接手聊天。',
  },
  tryIt: {
    title: '什么是“试一试”？',
    body: '练习聊天。输入客户可能会说的话，看看 AI 会怎么回答。不会发送到 WhatsApp，也不会改动任何聊天。',
  },
  voice: {
    title: '什么是语音消息转文字？',
    body: '把客户的语音消息转成文字，让 AI 和团队都能阅读。',
    stepsTitle: '两种方式',
    step1: '在这台电脑上：只需下载一次，免费，音频不会离开电脑。',
    step2: '在云端：更快，使用您的 OpenAI API 密钥，由 OpenAI 收费。',
    note: '两者都不用时，语音消息照样收到；AI 会转交给您的团队。',
  },
  tunnel: {
    title: '什么是手机访问？',
    body: 'EzyChat 运行在这台电脑上。手机访问通过 Cloudflare（免费服务）给它一个安全的网址，团队在任何地方都能用手机打开收件箱。这个连接叫做隧道。',
    note: '只有在这台电脑开着、EzyChat 运行时，网址才能使用。',
  },
  lan: {
    title: '什么是局域网访问？',
    body: '让连接同一 Wi-Fi 或办公室网络的手机和电脑打开收件箱，无需经过互联网。',
    note: '局域网流量不加密。只在您信任的网络中开启；其他地方请用手机访问。',
  },
  mcp: {
    title: '什么是 AI 助手访问？',
    body: '让您已经在用的 AI 应用（如 Claude 或 ChatGPT）读取收件箱并帮助您：总结聊天、查看数据、改进 AI 客服。MCP 是这些应用连接其他工具的标准。',
    note: '在您开启前一直关闭，而且您可以决定每个应用能做什么。',
  },
  accessToken: {
    title: '什么是访问令牌？',
    body: '电脑上的开发工具用来证明自己可以使用收件箱的秘密代码。claude.ai 和 ChatGPT 等应用会自行登录，不需要令牌。',
    note: '只复制一次并妥善保密。在这里撤销即可立即切断访问。',
  },
  connectors: {
    title: '什么是连接器？',
    body: '连接器让 AI 客服替您使用其他应用，例如在 Google 日历查看空档并预约。',
    note: '连接后即可查询；任何会更改数据的操作在您开启前保持关闭。',
  },
};

const dir = join(import.meta.dirname, 'src', 'i18n', 'locales');
for (const [lang, copy] of [
  ['en', en],
  ['ms', ms],
  ['zh-CN', zh],
]) {
  const file = join(dir, lang, 'common.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.mockTips = copy;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
