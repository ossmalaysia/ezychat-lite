import type { AppContext } from '../context.js';
import { startBackupScheduler, type BackupScheduler } from '../backup/scheduler.js';
import { createSettingsService, type SettingsService } from './settings-service.js';

export {
  createSettingsService,
  SETTINGS_KEYS,
  DEFAULT_HISTORY_DAYS,
  type SettingsService,
  type PatchSettingsResult,
} from './settings-service.js';
export { zipLogs, logsDir } from './logs.js';
export { runBackup, hasBackupFor, backupStamp, BACKUP_KEEP } from '../backup/backup.js';
export { startBackupScheduler, type BackupScheduler } from '../backup/scheduler.js';

declare module '../context.js' {
  interface Services {
    admin?: SettingsService;
    backup?: BackupScheduler;
  }
}

/** Service initializer (registered in services.ts): settings service + nightly backup scheduler. */
export function initAdmin(ctx: AppContext): void {
  ctx.services.admin = createSettingsService(ctx);
  ctx.services.backup = startBackupScheduler(ctx);
}
