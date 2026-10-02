// Wipes the e2e server data dir. Run by the Playwright webServer command *before* the server
// starts (Playwright launches webServer before globalSetup, so globalSetup cannot do this).
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), '.e2e-data');
rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
rmSync(resolve(process.cwd(), 'e2e/.auth'), { recursive: true, force: true });
