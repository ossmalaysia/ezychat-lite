import type { AppContext } from './context.js';

/**
 * Service initializers, run in order by startServer()/makeTestApp() before routes are built.
 * APPEND-ONLY SHARED FILE: later tasks add one import + one push line each, e.g.
 *   import { initAuth } from './auth/index.js';
 *   initializers.push(initAuth);
 */
export const initializers: Array<(ctx: AppContext) => void | Promise<void>> = [];

import { initTunnel } from './tunnel/index.js';
initializers.push(initTunnel);

import { initAuth } from './auth/index.js';
initializers.unshift(initAuth); // auth first: other services/guards depend on it

import { initAdmin } from './admin/index.js';
initializers.push(initAdmin);

import { initMessaging } from './wa-bridge/index.js';
initializers.push(initMessaging);

import { initPush } from './push/index.js';
initializers.push(initPush);

import { initVoice } from './voice/service.js';
initializers.push(initVoice);

import { initAi } from './ai/service.js';
initializers.push(initAi);
