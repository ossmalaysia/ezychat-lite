import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** What a button asks Ezy when it opens the panel (e.g. "Summarise this chat" from a conversation). */
export interface AskEzyRequest {
  question: string;
  chatJid?: string | null;
  /** Shown above the box while the question is about one chat. */
  chatName?: string | null;
}

interface AskEzyState {
  open: boolean;
  /** The question the panel sends as soon as it opens; cleared once sent. */
  pending: AskEzyRequest | null;
  openPanel: (request?: AskEzyRequest) => void;
  closePanel: () => void;
  takePending: () => AskEzyRequest | null;
}

/** Outside the provider (tests, isolated screens) the buttons do nothing. */
const NONE: AskEzyState = {
  open: false,
  pending: null,
  openPanel: () => {},
  closePanel: () => {},
  takePending: () => null,
};
const Ctx = createContext<AskEzyState>(NONE);

export function AskEzyProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AskEzyRequest | null>(null);
  const openPanel = useCallback((request?: AskEzyRequest) => {
    setPending(request ?? null);
    setOpen(true);
  }, []);
  const closePanel = useCallback(() => setOpen(false), []);
  const takePending = useCallback(() => {
    const p = pending;
    setPending(null);
    return p;
  }, [pending]);
  const value = useMemo(
    () => ({ open, pending, openPanel, closePanel, takePending }),
    [open, pending, openPanel, closePanel, takePending],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAskEzy(): AskEzyState {
  return useContext(Ctx);
}
