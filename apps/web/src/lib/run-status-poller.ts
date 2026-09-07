import { isTerminalRunStatus } from "./run-progress";

// TODO(live-updates): Replace this temporary run-status poll with the durable
// app-wide job event subscription when live updates are implemented.
export const RUN_STATUS_POLL_INTERVAL_MS = 5_000;

export function createRunStatusPoller<T extends { status: string }>(options: {
  fetchSnapshot: (signal: AbortSignal) => Promise<T>;
  onSnapshot: (snapshot: T) => void;
  onDelayed: () => void;
  onTerminal: (snapshot: T) => void;
  onScheduled?: (delay: number) => void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let stopped = true;

  const schedule = () => {
    options.onScheduled?.(RUN_STATUS_POLL_INTERVAL_MS);
    timer = setTimer(() => void poll(), RUN_STATUS_POLL_INTERVAL_MS);
  };
  const poll = async () => {
    if (stopped || request) return;
    request = new AbortController();
    try {
      const snapshot = await options.fetchSnapshot(request.signal);
      options.onSnapshot(snapshot);
      if (isTerminalRunStatus(snapshot.status)) {
        stopped = true;
        options.onTerminal(snapshot);
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        options.onDelayed();
    } finally {
      request = undefined;
      if (!stopped) schedule();
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void poll();
    },
    refresh() {
      if (stopped) return;
      if (timer) clearTimer(timer);
      timer = undefined;
      void poll();
    },
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = undefined;
      request?.abort();
    },
  };
}
