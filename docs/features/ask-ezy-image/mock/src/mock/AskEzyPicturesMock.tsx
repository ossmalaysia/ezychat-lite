import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

/**
 * Proposed (ask-ezy-image), mock only: pretend the Ask Ezy model cannot read pictures, or make the answer slow so the
 * sending state can be seen. Reload the panel (close and open) after a change.
 */
export function AskEzyPicturesMock() {
  const { t } = useTranslation('inbox');
  const [state, setState] = useState({ pictures: true, slow: false });
  useEffect(() => {
    void fetch('/api/mock/ask-ezy/status', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((s: { pictures?: boolean }) =>
        setState((v) => ({ ...v, pictures: s.pictures ?? true })),
      )
      .catch(() => {});
  }, []);
  const change = (patch: Partial<typeof state>) => {
    setState((v) => ({ ...v, ...patch }));
    void fetch('/api/mock/ask-ezy/mock-state', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
  };
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2 text-xs"
      data-testid="mock-ask-ezy-pictures"
    >
      <Badge variant="outline" className="self-start">
        {t('askEzy.pictures.mock.badge')}
      </Badge>
      <label className="flex items-center justify-between gap-3">
        {t('askEzy.pictures.mock.reads')}
        <Switch checked={state.pictures} onCheckedChange={(v) => change({ pictures: v })} />
      </label>
      <label className="flex items-center justify-between gap-3">
        {t('askEzy.pictures.mock.slow')}
        <Switch checked={state.slow} onCheckedChange={(v) => change({ slow: v })} />
      </label>
    </div>
  );
}
