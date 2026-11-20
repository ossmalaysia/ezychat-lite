import { describe, expect, it } from 'vitest';
import { PRESERVED_NOTE } from './release-notes.mjs';
import {
  compareReleaseVersions,
  draftProblems,
  expectedInstallers,
  isReleaseVersion,
  main,
  newestPublished,
  parseJsonLines,
  promotePlan,
} from './release-publish.mjs';

const NOTES = `### Added\n\n- Something new.\n\n${PRESERVED_NOTE}\n`;
const draft = (over = {}) => ({
  isDraft: true,
  body: NOTES,
  assets: expectedInstallers('0.1.75').map((name) => ({ name, size: 100, state: 'uploaded' })),
  ...over,
});

describe('isReleaseVersion', () => {
  it('accepts only a plain x.y.z', () => {
    expect(isReleaseVersion('0.1.75')).toBe(true);
    expect(isReleaseVersion('10.20.300')).toBe(true);
    for (const bad of [
      'v0.1.75',
      '0.1',
      '0.1.75-rc.1',
      '0.1.75\n',
      '0.1.75;rm -rf /',
      '$(id)',
      '',
      undefined,
      175,
    ]) {
      expect(isReleaseVersion(bad)).toBe(false);
    }
  });
});

describe('expectedInstallers', () => {
  it('lists the versioned installers and their permanent-link copies', () => {
    expect(expectedInstallers('0.1.75')).toEqual([
      'EzyChat-Lite-0.1.75-win-x64.exe',
      'EzyChat-Lite-0.1.75-mac-arm64.dmg',
      'EzyChat-Lite-0.1.75-mac-x64.dmg',
      'EzyChat-Lite-win-x64.exe',
      'EzyChat-Lite-mac-arm64.dmg',
      'EzyChat-Lite-mac-x64.dmg',
    ]);
  });
});

describe('draftProblems', () => {
  it('accepts a complete draft', () => {
    expect(draftProblems(draft(), '0.1.75')).toEqual([]);
  });

  it('refuses a missing, empty or still uploading installer', () => {
    const assets = draft().assets.slice(1);
    assets[0] = { ...assets[0], size: 0 };
    assets[1] = { ...assets[1], state: 'starter' };
    expect(draftProblems(draft({ assets }), '0.1.75')).toEqual([
      'missing installer EzyChat-Lite-0.1.75-win-x64.exe',
      'empty installer EzyChat-Lite-0.1.75-mac-arm64.dmg',
      'installer EzyChat-Lite-0.1.75-mac-x64.dmg is starter',
    ]);
  });

  it('refuses an installer without a size', () => {
    const assets = draft().assets.map((a, i) => (i === 0 ? { name: a.name } : a));
    expect(draftProblems(draft({ assets }), '0.1.75')).toEqual([
      'empty installer EzyChat-Lite-0.1.75-win-x64.exe',
    ]);
  });

  it('refuses installers of another version', () => {
    expect(draftProblems(draft(), '0.1.76')).toContain(
      'missing installer EzyChat-Lite-0.1.76-win-x64.exe',
    );
  });

  it('refuses a published release, empty notes and notes not written by release-notes.mjs', () => {
    expect(draftProblems(draft({ isDraft: false }), '0.1.75')).toEqual([
      'the release is not a draft (already published?)',
    ]);
    expect(draftProblems(draft({ body: '' }), '0.1.75')).toEqual(['the release notes are empty']);
    expect(draftProblems(draft({ body: `\n${PRESERVED_NOTE}\n` }), '0.1.75')).toEqual([
      'the release notes are empty',
    ]);
    expect(draftProblems(draft({ body: 'Hand-written' }), '0.1.75')).toEqual([
      'the release notes do not come from release-notes.mjs',
    ]);
  });

  it('refuses no release at all', () => {
    expect(draftProblems(null, '0.1.75')).toEqual(['no release found']);
  });
});

describe('compareReleaseVersions', () => {
  it('orders by number, not by text', () => {
    expect(compareReleaseVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareReleaseVersions('0.2.0', '0.1.99')).toBeGreaterThan(0);
    expect(compareReleaseVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareReleaseVersions('0.1.83', '0.1.83')).toBe(0);
    expect(compareReleaseVersions('0.1.83', '0.1.85')).toBeLessThan(0);
  });
});

const list = (...items) => items.map(([tag_name, draft = false]) => ({ tag_name, draft }));

describe('promotePlan', () => {
  it('promotes a complete held draft newer than every published release, or the first one', () => {
    const releases = list(['v0.1.74'], ['v0.1.75', true], ['v0.1.76', true]);
    expect(promotePlan(draft(), '0.1.75', releases)).toEqual({ problems: [], hold: [] });
    expect(promotePlan(draft(), '0.1.75', [])).toEqual({ problems: [], hold: [] });
  });

  it('orders by number: v0.1.100 is newer than v0.1.75', () => {
    expect(promotePlan(draft(), '0.1.75', list(['v0.1.100'])).problems).toEqual([
      'newer published release v0.1.100: run with hold_newer to turn it back into a draft',
    ]);
  });

  it('holds every newer published release, a published pre-release included, only with holdNewer', () => {
    const releases = [
      ...list(['v0.1.77'], ['v0.1.76'], ['v0.1.74'], ['v0.1.78', true], ['v0.2.0-beta.1']),
      { tag_name: 'v0.1.79', draft: false, prerelease: true },
    ];
    expect(promotePlan(draft(), '0.1.75', releases).problems).toEqual([
      'newer published releases v0.1.76, v0.1.77, v0.1.79: run with hold_newer to turn them back into a draft',
    ]);
    expect(promotePlan(draft(), '0.1.75', releases, { holdNewer: true })).toEqual({
      problems: [],
      hold: ['v0.1.76', 'v0.1.77', 'v0.1.79'],
    });
  });

  it('switches back to an already published version that still has its installers', () => {
    const published = draft({ isDraft: false });
    expect(
      promotePlan(published, '0.1.75', list(['v0.1.75'], ['v0.1.76']), { holdNewer: true }),
    ).toEqual({ problems: [], hold: ['v0.1.76'] });
    expect(promotePlan(published, '0.1.75', list(['v0.1.75']))).toEqual({ problems: [], hold: [] });
    expect(
      promotePlan(draft({ isDraft: false, assets: [] }), '0.1.75', [], { holdNewer: true })
        .problems,
    ).toHaveLength(6);
  });

  it('keeps every draft check and refuses no release at all', () => {
    expect(promotePlan(draft({ body: '' }), '0.1.75', []).problems).toEqual([
      'the release notes are empty',
    ]);
    expect(promotePlan(null, '0.1.75', [])).toEqual({ problems: ['no release found'], hold: [] });
    expect(promotePlan(draft(), '0.1.75', null)).toEqual({ problems: [], hold: [] });
  });
});

describe('newestPublished', () => {
  it('gives the highest published plain tag, skipping drafts and previews', () => {
    expect(
      newestPublished([
        ...list(['v0.1.9'], ['v0.1.10'], ['v0.1.11', true], ['v0.2.0-rc.1'], ['x']),
        null,
      ]),
    ).toBe('v0.1.10');
    expect(newestPublished([])).toBe('');
    expect(newestPublished(undefined)).toBe('');
  });
});

describe('parseJsonLines', () => {
  it('reads one object per line and skips blank lines', () => {
    expect(parseJsonLines('{"a":1}\n\n {"a":2} \n')).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe('main', () => {
  const run = (argv, files = {}) => {
    const out = [];
    const err = [];
    const code = main(argv, {
      read: (p) => {
        if (!(p in files)) throw new Error('ENOENT');
        return files[p];
      },
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    return { code, out, err };
  };

  it('checks the version input before anything else', () => {
    expect(run(['version', '0.1.75']).code).toBe(0);
    const bad = run(['version', '0.1.75 && curl x']);
    expect(bad.code).toBe(2);
    expect(bad.err[0]).toContain('not a release version');
    expect(run(['draft', 'v0.1.75', 'r.json']).code).toBe(2);
  });

  it('passes a complete draft and fails an incomplete one with every reason', () => {
    const ok = run(['draft', '0.1.75', 'r.json'], { 'r.json': JSON.stringify(draft()) });
    expect(ok).toEqual({ code: 0, out: ['v0.1.75: draft has 6 installers and notes'], err: [] });
    const bad = run(['draft', '0.1.75', 'r.json'], {
      'r.json': JSON.stringify(draft({ assets: [] })),
    });
    expect(bad.code).toBe(1);
    expect(bad.err).toHaveLength(6);
    expect(bad.err[0]).toBe('::error::v0.1.75: missing installer EzyChat-Lite-0.1.75-win-x64.exe');
  });

  it('promote prints the tags to hold and fails with every reason', () => {
    const files = {
      'r.json': JSON.stringify(draft()),
      'l.jsonl': '{"tag_name":"v0.1.74","draft":false}\n{"tag_name":"v0.1.76","draft":false}\n',
      'none.jsonl': '',
    };
    expect(run(['promote', '0.1.75', 'r.json', 'none.jsonl'], files)).toEqual({
      code: 0,
      out: [],
      err: [],
    });
    expect(run(['promote', '0.1.75', 'r.json', 'l.jsonl', '--hold-newer'], files)).toEqual({
      code: 0,
      out: ['v0.1.76'],
      err: [],
    });
    const refused = run(['promote', '0.1.75', 'r.json', 'l.jsonl'], files);
    expect(refused.code).toBe(1);
    expect(refused.err).toEqual([
      '::error::v0.1.75: newer published release v0.1.76: run with hold_newer to turn it back into a draft',
    ]);
    expect(run(['promote', '0.1.75', 'r.json', 'missing.jsonl'], files).code).toBe(1);
    expect(run(['promote', '0.1.75', 'r.json', 'l.jsonl', '--yes'], files).code).toBe(2);
    expect(run(['promote', '0.1.75', 'r.json'], files).code).toBe(2);
    expect(run(['promote', '0.1.75 ;id', 'r.json', 'l.jsonl'], files).code).toBe(2);
  });

  it('newest prints the newest published tag', () => {
    const files = {
      'l.jsonl': '{"tag_name":"v0.1.74","draft":false}\n{"tag_name":"v0.1.76","draft":true}\n',
    };
    expect(run(['newest', 'l.jsonl'], files)).toEqual({ code: 0, out: ['v0.1.74'], err: [] });
    expect(run(['newest', 'missing.jsonl'], files).code).toBe(1);
  });

  it('fails on an unreadable file and on unknown commands', () => {
    expect(run(['draft', '0.1.75', 'missing.json']).code).toBe(1);
    expect(run(['draft', '0.1.75', 'r.json'], { 'r.json': '{' }).code).toBe(1);
    expect(run(['publish', '0.1.75']).code).toBe(2);
    expect(run(['draft', '0.1.75']).code).toBe(2);
  });
});
