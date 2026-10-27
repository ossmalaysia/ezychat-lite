import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConnectorEntry } from '@ezychat/shared';
import { connectorSchema, SCHEMA_ID, schemaText } from './connector-schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('connector entry JSON Schema', () => {
  it('is generated from the contract with every entry field', () => {
    const schema = connectorSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe(SCHEMA_ID);
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(ConnectorEntry.shape).sort());
    expect(schema.required).toEqual(
      expect.arrayContaining(['id', 'schemaVersion', 'minAppVersion', 'kind', 'editions', 'name']),
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.schemaVersion.const).toBe(1);
    // One branch per sign-in type, and nested objects are closed too.
    const auth = JSON.stringify(schema.properties.auth);
    for (const type of ['oauth', 'oauth_own_app', 'api_key', 'credentials', 'none'])
      expect(auth).toContain(`"${type}"`);
    expect(schema.properties.icon.additionalProperties).toBe(false);
    expect(JSON.parse(schemaText())).toEqual(schema);
  });

  it('the documented command prints the same JSON', () => {
    const text = execFileSync(
      process.execPath,
      ['--conditions=ezychat-source', '--import', 'tsx', 'scripts/connector-schema.mjs'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(text).toBe(schemaText());
    expect(JSON.parse(text).properties).toHaveProperty('tools');
  });
});
