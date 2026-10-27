import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { contextMenuTemplate, type ContextMenuInput } from './context-menu.js';

const BASE = 'http://127.0.0.1:7420';
const isInbox = (url: string) => url.startsWith(`${BASE}/`);

function input(over: Partial<ContextMenuInput> = {}): ContextMenuInput {
  return {
    x: 10,
    y: 20,
    isEditable: false,
    selectionText: '',
    mediaType: 'none',
    srcURL: '',
    linkURL: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canSelectAll: true,
    },
    ...over,
  };
}

function actions() {
  return {
    replaceMisspelling: vi.fn(),
    addToDictionary: vi.fn(),
    copyImageAt: vi.fn(),
    downloadURL: vi.fn(),
    writeText: vi.fn(),
  };
}

const labels = (items: MenuItemConstructorOptions[]) =>
  items.map((i) => (i.type === 'separator' ? '—' : i.label));
const click = (items: MenuItemConstructorOptions[], label: string) =>
  (items.find((i) => i.label === label)!.click as () => void)();

describe('inbox window context menu', () => {
  it('offers cut, copy and paste in the message box, with roles Electron runs', () => {
    const items = contextMenuTemplate(input({ isEditable: true }), actions(), isInbox, 'en');
    expect(labels(items)).toEqual([
      'Undo',
      'Redo',
      '—',
      'Cut',
      'Copy',
      'Paste',
      'Paste as plain text',
      '—',
      'Select all',
    ]);
    expect(items.find((i) => i.label === 'Paste')).toMatchObject({ role: 'paste', enabled: true });
    expect(items.find((i) => i.label === 'Undo')).toMatchObject({ role: 'undo', enabled: false });
  });

  it('offers Copy for selected message text and nothing on empty space', () => {
    expect(
      labels(contextMenuTemplate(input({ selectionText: 'RM 25' }), actions(), isInbox, 'en')),
    ).toEqual(['Copy']);
    expect(contextMenuTemplate(input({ selectionText: '  ' }), actions(), isInbox, 'en')).toEqual(
      [],
    );
  });

  it('copies or saves an inbox image, never a preview or another site’s image', () => {
    const a = actions();
    const src = `${BASE}/api/media/3EB0`;
    const items = contextMenuTemplate(input({ mediaType: 'image', srcURL: src }), a, isInbox, 'en');
    expect(labels(items)).toEqual(['Copy image', 'Save image as…']);
    click(items, 'Copy image');
    expect(a.copyImageAt).toHaveBeenCalledWith(10, 20);
    click(items, 'Save image as…');
    expect(a.downloadURL).toHaveBeenCalledWith(src);
    for (const other of ['blob:http://127.0.0.1:7420/x', 'https://evil.example/a.png'])
      expect(
        contextMenuTemplate(input({ mediaType: 'image', srcURL: other }), a, isInbox, 'en'),
      ).toEqual([]);
  });

  it('copies an outside link address, but not app links or script links', () => {
    const a = actions();
    const items = contextMenuTemplate(
      input({ linkURL: 'https://shop.example/p/1' }),
      a,
      isInbox,
      'en',
    );
    click(items, 'Copy link address');
    expect(a.writeText).toHaveBeenCalledWith('https://shop.example/p/1');
    expect(contextMenuTemplate(input({ linkURL: `${BASE}/chats/1` }), a, isInbox, 'en')).toEqual(
      [],
    );
    expect(
      contextMenuTemplate(input({ linkURL: 'javascript:alert(1)' }), a, isInbox, 'en'),
    ).toEqual([]);
  });

  it('puts spelling suggestions first and adds a word to the dictionary', () => {
    const a = actions();
    const items = contextMenuTemplate(
      input({
        isEditable: true,
        misspelledWord: 'recieve',
        dictionarySuggestions: ['receive', 'relieve', 'reprieve', 'retrieve', 'recede', 'recite'],
      }),
      a,
      isInbox,
      'en',
    );
    expect(labels(items).slice(0, 7)).toEqual([
      'receive',
      'relieve',
      'reprieve',
      'retrieve',
      'recede',
      'Add to dictionary',
      '—',
    ]);
    click(items, 'receive');
    expect(a.replaceMisspelling).toHaveBeenCalledWith('receive');
    click(items, 'Add to dictionary');
    expect(a.addToDictionary).toHaveBeenCalledWith('recieve');
    const none = contextMenuTemplate(
      input({ isEditable: true, misspelledWord: 'zzxq' }),
      a,
      isInbox,
      'en',
    );
    expect(none[0]).toMatchObject({ label: 'No spelling suggestions', enabled: false });
  });

  it('speaks the desktop language', () => {
    expect(
      labels(contextMenuTemplate(input({ selectionText: 'a' }), actions(), isInbox, 'ms')),
    ).toEqual(['Salin']);
    expect(
      labels(contextMenuTemplate(input({ selectionText: 'a' }), actions(), isInbox, 'zh-CN')),
    ).toEqual(['复制']);
  });
});
