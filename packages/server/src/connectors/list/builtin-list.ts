import entries from './builtin-list.json' with { type: 'json' };

/**
 * The connector list shipped in the app: used until a signed list was downloaded and saved once
 * (state `builtin`). Same entries as anchorsprint/ezychat-connectors at its first publish (today's
 * gallery: the built-in Google Calendar and the coming-soon connectors), without icons (the web
 * shows category icons). The entries are data in `builtin-list.json` (texts: en, ms, zh-CN);
 * `minAppVersion` 0.0.0 because they ship inside the app. Sequence 0, so any downloaded list
 * replaces it.
 */
export const BUILTIN_CONNECTOR_LIST: { sequence: 0; entries: readonly unknown[] } = {
  sequence: 0,
  entries,
};
