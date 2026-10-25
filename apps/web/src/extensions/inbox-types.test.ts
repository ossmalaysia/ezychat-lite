import { describe, expect, it } from 'vitest';
import { inboxTypesOf } from './inbox-types';
import type { WebExtension, WebExtensionInboxType } from './types';

const type = (id: string, labelKey: string): WebExtensionInboxType => ({
  type: id,
  labelKey,
  descriptionKey: `${labelKey}.description`,
  CreateForm: () => null,
});

describe('inboxTypesOf', () => {
  it('lists every type in extension order; the first extension wins a duplicate', () => {
    const a: WebExtension = { name: 'aaa', inboxTypes: [type('wa-cloud', 'ext.aaa.cloud')] };
    const b: WebExtension = {
      name: 'bbb',
      inboxTypes: [type('wa-cloud', 'ext.bbb.cloud'), type('telegram', 'ext.bbb.tg')],
    };
    expect(inboxTypesOf([a, b]).map((x) => x.labelKey)).toEqual(['ext.aaa.cloud', 'ext.bbb.tg']);
  });

  it('never lets an extension replace the linked phone, and is empty in Lite', () => {
    const c: WebExtension = { name: 'ccc', inboxTypes: [type('linked_phone', 'ext.ccc.phone')] };
    expect(inboxTypesOf([c])).toEqual([]);
    expect(inboxTypesOf([])).toEqual([]);
  });
});
