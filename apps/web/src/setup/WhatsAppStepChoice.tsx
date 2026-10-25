import { useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '../api/queries';
import { ExtensionBoundary, useExtensionTranslation, useInboxTypes } from '../extensions';
import { SegmentedControl } from '@/components/app';
import { Button } from '@/components/ui/button';

const LINKED_PHONE = 'linked_phone';

/**
 * The setup wizard's WhatsApp step. With an extension inbox type that can connect inbox 1 (e.g. the
 * WhatsApp Business API), it starts with the choice between the QR scan (default) and that type;
 * without one (Lite) it is the QR step unchanged.
 */
export function WhatsAppStepChoice({
  phoneStep,
  onContinue,
  onSkip,
}: Readonly<{
  /** The QR step (`WaLinkStep`). */
  phoneStep: React.ReactNode;
  onContinue(): void;
  onSkip(): void;
}>) {
  const { t } = useTranslation(['auth', 'common']);
  const tx = useExtensionTranslation();
  const qc = useQueryClient();
  const types = useInboxTypes().filter((x) => x.SetupForm);
  const [choice, setChoice] = useState(LINKED_PHONE);
  /** The type that connected inbox 1 in this wizard. */
  const [connected, setConnected] = useState<string | null>(null);

  if (types.length === 0) return <>{phoneStep}</>;
  const chosen = types.find((x) => x.type === choice);

  return (
    <div className="flex flex-col gap-5" data-testid="wa-step-choice">
      <div className="flex flex-col gap-2">
        <span id="wa-choice-label" className="text-sm font-medium">
          {t('setup.wa.choice')}
        </span>
        <SegmentedControl
          aria-labelledby="wa-choice-label"
          aria-describedby="wa-choice-hint"
          value={choice}
          onValueChange={setChoice}
          className="w-full [&>label]:flex-1"
          options={[
            { value: LINKED_PHONE, label: t('setup.wa.choicePhone') },
            ...types.map((x) => ({ value: x.type, label: tx(x.labelKey) })),
          ]}
        />
        <p id="wa-choice-hint" className="text-sm text-muted-foreground">
          {chosen ? tx(chosen.descriptionKey) : t('setup.wa.choicePhoneHint')}
        </p>
      </div>

      {!chosen && phoneStep}

      {chosen?.SetupForm && (
        <div className="flex flex-col gap-5">
          <ExtensionBoundary>
            <chosen.SetupForm
              onConnected={() => {
                setConnected(chosen.type);
                void qc.invalidateQueries({ queryKey: qk.inboxes });
                void qc.invalidateQueries({ queryKey: qk.wa });
              }}
            />
          </ExtensionBoundary>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {connected !== chosen.type && (
              <Button variant="ghost" size="touch" onClick={onSkip}>
                {t('setup.wa.skip')}
              </Button>
            )}
            <Button size="touch" onClick={onContinue} disabled={connected !== chosen.type}>
              {t('common:actions.continue')}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
