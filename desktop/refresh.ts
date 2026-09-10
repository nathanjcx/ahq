/** Polls share one run; completion notifications retain one follow-up while busy. */
export function createRefresh(
  action: () => void | Promise<void>,
  onError: (error: unknown) => void | Promise<void>,
): (followUpIfBusy?: boolean) => Promise<void> {
  let active: Promise<void> | undefined;
  let followUp = false;

  async function drain() {
    for (;;) {
      try {
        await action();
      } catch (error) {
        try {
          await onError(error);
        } catch {
          // Reporting failures must not strand future refreshes or their notifications.
        }
      }
      if (!followUp) {
        // Clear synchronously with the final check. A later notification starts a
        // fresh run instead of being lost between promise settlement and cleanup.
        active = undefined;
        return;
      }
      followUp = false;
    }
  }

  return (followUpIfBusy = false) => {
    if (active) {
      if (followUpIfBusy) followUp = true;
      return active;
    }
    followUp = false;
    // Assign active before action runs, including for synchronous/reentrant callbacks.
    active = Promise.resolve().then(drain);
    return active;
  };
}
