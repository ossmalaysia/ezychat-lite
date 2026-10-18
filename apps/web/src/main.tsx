import { createInboxApp } from './create-app';

// Lite: the inbox app with no extensions. Other product builds call `createInboxApp` from the
// package entry (`src/index.ts`) with their own extensions.
void createInboxApp({ extensions: [] });
