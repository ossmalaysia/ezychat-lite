// Dev Build check: the chat preview the app makes from a stored photo (feat/own-image-preview).
// Run against a fresh Dev Build with fake WhatsApp and temp data:
//   node apps/desktop/dist/server/server.cjs --data <tmp> --port 7488 --mode dev --fake-wa
//   node e2e/devbuild-image-preview.mjs 7488
// Sends one 1500 x 2000 photo (the dev route takes 1 MB) through fake WhatsApp, then checks the chat gets an 800 px preview from the
// bundled worker, cached long, much smaller than the photo, and that a second view is read from storage.
import { randomBytes } from 'node:crypto';
import jpeg from 'jpeg-js';

const port = Number(process.argv[2] ?? 7488);
const base = `http://127.0.0.1:${port}`;
const origin = { origin: base };
let cookie = '';
const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...origin,
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return res;
};
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};

// a photo-sized JPEG with detail (a gradient), as a phone would send
const width = 1500;
const height = 2000;
const data = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = x % 256;
    data[i + 1] = y % 256;
    data[i + 2] = (x + y) % 256;
    data[i + 3] = 255;
  }
const photo = Buffer.from(jpeg.encode({ data, width, height }, 80).data);

const setup = await call('POST', '/api/setup/admin', {
  username: 'checker',
  displayName: 'Checker',
  password: randomBytes(18).toString('base64url'),
});
check(setup.ok, `first admin created (${setup.status})`);

const sent = await call('POST', '/api/dev/fake-incoming', {
  chatJid: '60120000001@s.whatsapp.net',
  senderName: 'Photo Tester',
  text: 'Box made into table',
  type: 'image',
  media: { mime: 'image/jpeg', base64: photo.toString('base64') },
});
check(sent.ok, `fake photo received (${sent.status}), ${Math.round(photo.length / 1024)} KB`);

const list = await (await call('GET', '/api/chats/60120000001@s.whatsapp.net/messages')).json();
const msg = (list.messages ?? list.items ?? list).find?.((m) => m.type === 'image');
check(
  Boolean(msg?.mediaThumbUrl?.endsWith('/thumb?v=2')),
  `message links the preview (${msg?.mediaThumbUrl})`,
);

const t0 = Date.now();
const first = await call('GET', msg.mediaThumbUrl);
const firstMs = Date.now() - t0;
const bytes = Buffer.from(await first.arrayBuffer());
check(first.status === 200, `preview answers 200 in ${firstMs} ms (made by the worker)`);
const img = jpeg.decode(bytes);
check(img.width === 600 && img.height === 800, `preview is ${img.width} x ${img.height}`);
check(
  bytes.length < photo.length / 2,
  `preview is ${Math.round(bytes.length / 1024)} KB (photo ${Math.round(photo.length / 1024)} KB)`,
);
check(
  first.headers.get('cache-control') === 'private, max-age=2592000, immutable',
  `cached long: ${first.headers.get('cache-control')}`,
);

const t1 = Date.now();
const again = Buffer.from(await (await call('GET', msg.mediaThumbUrl)).arrayBuffer());
check(again.equals(bytes), `second view is the stored preview (${Date.now() - t1} ms)`);

const full = await call('GET', msg.mediaUrl);
check(
  full.status === 200 && Number(full.headers.get('content-length')) === photo.length,
  'opening the photo still gives the full file',
);
