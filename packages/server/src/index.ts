// Public API for other product builds. Anything not exported here is internal.
export { buildApp } from './app.js';
export { requireAdmin, requireUser } from './auth/guards.js';
export { parseArgs, type ServerConfig } from './config.js';
export type { AppContext, Services } from './context.js';
export { EXTENSION_NAME, type ServerExtension } from './extensions.js';
export { createContext, runInitializers, shutdownServices, startServer } from './main.js';
export { runCli, type CliProduct } from './run-cli.js';
