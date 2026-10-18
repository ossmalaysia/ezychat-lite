import { activeProduct, type Product } from './product.js';

/**
 * Windows AppUserModelID of the installed app (`product.appUserModelId`); the installer's shortcuts
 * carry the same id. Unpackaged (dev, test harness) runs use their own id. Windows ties a taskbar
 * button to the Start Menu shortcut with the window's id; a dev run registered under the installed id
 * once left an "Electron.lnk" pointing at a deleted electron.exe, and the installed app then showed a
 * blank icon.
 */
export function appUserModelId(isPackaged: boolean, product: Product = activeProduct()): string {
  return isPackaged ? product.appUserModelId : `${product.appUserModelId}.dev`;
}
