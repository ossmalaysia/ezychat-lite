/**
 * Public keys (Ed25519, raw 32 bytes, base64) that may sign the connector list
 * (`list-v1.json.sig`). Two keys: the current one and the next one, so the publisher can move to the
 * next key without breaking installed apps. The private keys live only in the protected `release`
 * environment of anchorsprint/ezychat-connectors; replacing a key here needs an app release.
 */
export const CONNECTOR_LIST_PUBLIC_KEYS: readonly string[] = [
  'WQcWCTgSXVtgEajSoznP+DrQ+qwyyhi0k9iVKw633bg=',
  '/u12jg98QvmQenYffdSO/GK/trCAGQ4MJ6pLF5yJrVs=',
];

/** Where the list, its signature and the icons are published. */
export const CONNECTOR_LIST_BASE_URL = 'https://dl.ezychat.ai/connectors/';
