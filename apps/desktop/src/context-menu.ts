// Right-click menu of the inbox window. Electron shows none by default, so without it nobody could
// cut, copy or paste with the mouse, copy an image or pick a spelling suggestion.
import type { ContextMenuParams, Event, MenuItemConstructorOptions, WebContents } from 'electron';
import type { Locale } from '@ezychat/shared';
import { t } from './i18n.js';

/** The parts of Electron's `ContextMenuParams` the menu reads. */
export interface ContextMenuInput {
  x: number;
  y: number;
  isEditable: boolean;
  selectionText: string;
  mediaType: string;
  srcURL: string;
  linkURL: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
}

/** What the menu items do; the window passes its `webContents` and clipboard. */
export interface ContextMenuActions {
  replaceMisspelling(word: string): void;
  addToDictionary(word: string): void;
  copyImageAt(x: number, y: number): void;
  downloadURL(url: string): void;
  writeText(text: string): void;
}

const MAX_SUGGESTIONS = 5;

function isWebLink(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url);
}

/**
 * The menu for one right-click; empty when there is nothing to offer (no menu then). Images are
 * offered only from the inbox server itself (`isInboxUrl`), never a blob: preview or another site.
 */
export function contextMenuTemplate(
  p: ContextMenuInput,
  a: ContextMenuActions,
  isInboxUrl: (url: string) => boolean,
  locale: Locale,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const group = (next: MenuItemConstructorOptions[]) => {
    if (next.length === 0) return;
    if (items.length > 0) items.push({ type: 'separator' });
    items.push(...next);
  };

  if (p.isEditable && p.misspelledWord) {
    const words = p.dictionarySuggestions.slice(0, MAX_SUGGESTIONS);
    group([
      ...(words.length
        ? words.map((word) => ({ label: word, click: () => a.replaceMisspelling(word) }))
        : [{ label: t(locale, 'contextMenu.noSuggestions'), enabled: false }]),
      {
        label: t(locale, 'contextMenu.addToDictionary'),
        click: () => a.addToDictionary(p.misspelledWord),
      },
    ]);
  }

  if (p.mediaType === 'image' && p.srcURL && isInboxUrl(p.srcURL)) {
    group([
      { label: t(locale, 'contextMenu.copyImage'), click: () => a.copyImageAt(p.x, p.y) },
      { label: t(locale, 'contextMenu.saveImage'), click: () => a.downloadURL(p.srcURL) },
    ]);
  }

  if (p.linkURL && isWebLink(p.linkURL) && !isInboxUrl(p.linkURL)) {
    group([{ label: t(locale, 'contextMenu.copyLink'), click: () => a.writeText(p.linkURL) }]);
  }

  if (p.isEditable) {
    const f = p.editFlags;
    group([
      { role: 'undo', label: t(locale, 'contextMenu.undo'), enabled: f.canUndo },
      { role: 'redo', label: t(locale, 'contextMenu.redo'), enabled: f.canRedo },
      { type: 'separator' },
      { role: 'cut', label: t(locale, 'contextMenu.cut'), enabled: f.canCut },
      { role: 'copy', label: t(locale, 'contextMenu.copy'), enabled: f.canCopy },
      { role: 'paste', label: t(locale, 'contextMenu.paste'), enabled: f.canPaste },
      {
        role: 'pasteAndMatchStyle',
        label: t(locale, 'contextMenu.pastePlain'),
        enabled: f.canPaste,
      },
      { type: 'separator' },
      { role: 'selectAll', label: t(locale, 'contextMenu.selectAll'), enabled: f.canSelectAll },
    ]);
  } else if (p.selectionText.trim()) {
    group([{ role: 'copy', label: t(locale, 'contextMenu.copy') }]);
  }

  return items;
}

/** The `webContents` parts the menu uses (a fake in tests). */
export type ContextMenuContents = Pick<
  WebContents,
  'replaceMisspelling' | 'copyImageAt' | 'downloadURL'
> & {
  session: Pick<WebContents['session'], 'addWordToSpellCheckerDictionary'>;
  on(event: 'context-menu', listener: (event: Event, params: ContextMenuParams) => void): unknown;
};

/** Shows the menu on every right-click in `wc`; `popup` builds and shows the native menu. */
export function registerContextMenu(
  wc: ContextMenuContents,
  o: {
    isInboxUrl(url: string): boolean;
    locale: Locale;
    writeText(text: string): void;
    popup(template: MenuItemConstructorOptions[]): void;
  },
): void {
  wc.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate(
      params,
      {
        replaceMisspelling: (word) => wc.replaceMisspelling(word),
        addToDictionary: (word) => void wc.session.addWordToSpellCheckerDictionary(word),
        copyImageAt: (x, y) => wc.copyImageAt(x, y),
        downloadURL: (url) => wc.downloadURL(url),
        writeText: o.writeText,
      },
      o.isInboxUrl,
      o.locale,
    );
    if (template.length > 0) o.popup(template);
  });
}
