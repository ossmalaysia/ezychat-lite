export * from './types.js';
export { FakeWaAdapter, type FakeSentRecord } from './fake/fake-adapter.js';
export { createBaileysAdapter } from './baileys/index.js';
export { readStoredLidMappings } from './baileys/stored-lid-mappings.js';
export { contactAliasPair, normalizeContactJid } from './baileys/contact-aliases.js';
