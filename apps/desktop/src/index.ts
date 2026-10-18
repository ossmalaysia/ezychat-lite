// Public entry of @ezychat/desktop for other editions (Lite's own Electron entry is main.ts, the
// package.json `main` field). An edition's Electron main file sets its product and starts the shell:
//
//   import { defineProduct, startDesktop } from '@ezychat/desktop';
//   await startDesktop(defineProduct({ ... }));
//
// Only these exports are public API; everything else in the package is internal and may change.
// The app layout the edition provides (server bundle, web build, icons, cloudflared, WinSW) is described
// in docs/editions-engineer-guide.md.
import { setActiveProduct, type Product } from './product.js';

export {
  LITE_PRODUCT,
  activeProduct,
  defineProduct,
  setActiveProduct,
  updateFeedOf,
  type Product,
  type StatusSectionContext,
  type StatusSectionModel,
  type StatusSectionProvider,
  type UpdateFeed,
} from './product.js';

/**
 * Starts the desktop shell (single instance, server, window, tray, status window, OS service, updater).
 * Pass the edition's product (from `defineProduct`); without one the shell runs as EzyChat Lite. Call it
 * once, from the Electron main process, before anything else imports the shell.
 */
export async function startDesktop(product?: Product): Promise<void> {
  if (product) setActiveProduct(product);
  // Dynamic import: main.ts runs on load and reads the active product, so it must load after this.
  await import('./main.js');
}
