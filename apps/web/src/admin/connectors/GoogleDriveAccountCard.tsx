import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import {
  googleDriveKey,
  useGoogleDrive,
  useGoogleDriveConnect,
  useGoogleDriveDisconnect,
  useGoogleDriveProgress,
} from '../../api/connectors';
import { GoogleAccountCard, useGoogleConnectFlow } from './google-connect';

/**
 * The Google account Google Drive uses (one per install, its own sign-in): connect, its state and
 * Disconnect. Each AI agent's folder and files live on the Settings tab.
 */
export function GoogleDriveAccountCard({
  onOpenSettings,
}: Readonly<{ onOpenSettings?: () => void }>) {
  const { t } = useTranslation('admin');
  const flow = useGoogleConnectFlow({
    useStart: useGoogleDriveConnect,
    useProgress: useGoogleDriveProgress,
    statusKey: googleDriveKey,
    connectedToast: t('connectors.gd.connectedToast'),
  });
  return (
    <GoogleAccountCard
      testId="google-drive-account"
      icon={HardDrive}
      query={useGoogleDrive()}
      flow={flow}
      disconnect={useGoogleDriveDisconnect()}
      onOpenSettings={onOpenSettings}
      texts={{
        description: t('connectors.gd.accountDescription'),
        what: [t('connectors.gd.what1'), t('connectors.gd.what2'), t('connectors.gd.what3')],
        connect: t('connectors.gd.connect'),
        connectHint: t('connectors.gd.connectHint'),
        expiredBody: t('connectors.gd.expiredBody'),
        unavailableTitle: t('connectors.gd.unavailableTitle'),
        unavailableBody: t('connectors.gd.unavailableBody'),
        perAgent: t('connectors.gd.perAgent'),
        disconnectTitle: t('connectors.gd.disconnectTitle'),
        disconnectBody: t('connectors.gd.disconnectBody'),
        disconnected: t('connectors.gd.disconnected'),
      }}
    />
  );
}
