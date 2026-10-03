/** One main-process gate for service/data changes, including confirmation and recovery. */
export function createServiceOperation(
  setBusy: (label: string | null) => void,
  showError: (title: string, error: unknown) => void,
) {
  let running = false;
  return async (
    label: string,
    errorTitle: string,
    action: () => Promise<void>,
    recover?: () => Promise<void>,
  ): Promise<void> => {
    if (running) return;
    running = true;
    setBusy(label);
    try {
      await action();
    } catch (error) {
      showError(errorTitle, error);
      await recover?.();
    } finally {
      running = false;
      setBusy(null);
    }
  };
}
