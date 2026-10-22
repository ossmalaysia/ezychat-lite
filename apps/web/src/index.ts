/**
 * Public web API (`@ezychat/web`): everything another product build needs to add UI to the inbox
 * without forking Lite or deep-importing its modules.
 */
export { createInboxApp, type CreateInboxAppOptions } from './create-app';
export {
  EXTENSION_NAME_PATTERN,
  WEB_EXTENSION_ADMIN_SECTIONS,
  WebExtensionError,
  extensionKeyPrefix,
  extensionPath,
  useAgentSection,
  useExtensionTranslation,
  validateWebExtensions,
  type AgentSectionInfo,
  type ExtensionTranslate,
  type WebExtension,
  type WebExtensionAdminSection,
  type WebExtensionAgent,
  type WebExtensionAgentSection,
  type WebExtensionCatalogs,
  type WebExtensionLockScreenProps,
  type WebExtensionNavBadge,
  type WebExtensionNavItem,
  type WebExtensionRoute,
  type WebExtensionSettingsSection,
} from './extensions';

// Outside links (createInboxApp({ links })), the access lock screen and the slim banner bar.
export { useAppLinks } from '@/lib/app-links';
export { LITE_APP_LINKS, type AppLinks } from '@/lib/links';
export { PausedScreen } from './access/AccessGate';
export { SlimBanner } from './access/BannerSlot';
export { AppMark, AuthShell } from './auth/AuthShell';

// Hooks and helpers an extension page needs (same instances as the core app).
export { useTranslation, Trans } from 'react-i18next';
export { useAuth, type AuthValue } from './auth/AuthProvider';
export { api, ApiError, errorMessage } from './api/client';
export { cn } from '@/lib/utils';

// App composites.
export {
  Banner,
  EmptyState,
  PageHeader,
  ResponsiveDialog,
  ResponsiveTable,
  SegmentedControl,
  StatusDot,
  type Column,
  type SegmentedOption,
  type StatusTone,
} from '@/components/app';
export { ErrorBoundary } from '@/components/app/ErrorBoundary';

// shadcn/ui primitives.
export * from '@/components/ui/alert-dialog';
export * from '@/components/ui/avatar';
export * from '@/components/ui/badge';
export * from '@/components/ui/button';
export * from '@/components/ui/card';
export * from '@/components/ui/checkbox';
export * from '@/components/ui/command';
export * from '@/components/ui/dialog';
export * from '@/components/ui/drawer';
export * from '@/components/ui/dropdown-menu';
export * from '@/components/ui/input';
export * from '@/components/ui/label';
export * from '@/components/ui/popover';
export * from '@/components/ui/progress';
export * from '@/components/ui/radio-group';
export * from '@/components/ui/scroll-area';
export * from '@/components/ui/select';
export * from '@/components/ui/separator';
export * from '@/components/ui/sheet';
export * from '@/components/ui/skeleton';
export * from '@/components/ui/sonner';
export * from '@/components/ui/switch';
export * from '@/components/ui/table';
export * from '@/components/ui/tabs';
export * from '@/components/ui/textarea';
export * from '@/components/ui/tooltip';
