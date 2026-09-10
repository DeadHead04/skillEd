import assert from "node:assert/strict";
import test from "node:test";
import {
  createRunStatusPoller,
  RUN_STATUS_POLL_INTERVAL_MS,
} from "../run-status-poller.js";

test("polls every 15 seconds without overlapping requests", async () => {
  const delays: number[] = [];
  const callbacks: Array<() => void> = [];
  let calls = 0;
  let release!: () => void;
  let markSeen!: () => void;
  const seen = new Promise<void>((resolve) => {
    markSeen = resolve;
  });
  const pending = new Promise<{ status: string }>((resolve) => {
    release = () => resolve({ status: "running" });
  });
  const poller = createRunStatusPoller({
    fetchSnapshot: async () => {
      calls++;
      return pending;
    },
    onSnapshot: () => markSeen(),
    onDelayed: () => undefined,
    onTerminal: () => undefined,
    setTimer: ((callback: () => void, delay: number) => {
      callbacks.push(callback);
      delays.push(delay);
      return 1 as any;
    }) as typeof setTimeout,
    clearTimer: (() => undefined) as typeof clearTimeout,
  });
  poller.start();
  poller.refresh();
  assert.equal(calls, 1);
  release();
  await seen;
  await Promise.resolve();
  assert.deepEqual(delays, [RUN_STATUS_POLL_INTERVAL_MS]);
  assert.equal(callbacks.length, 1);
  poller.stop();
});

test("keeps polling after transient failure and stops on terminal status", async () => {
  const callbacks: Array<() => void> = [];
  let delayed = 0;
  let terminal = 0;
  let attempt = 0;
  const poller = createRunStatusPoller({
    fetchSnapshot: async () => {
      attempt++;
      if (attempt === 1) throw new Error("temporary");
      return { status: "failed" };
    },
    onSnapshot: () => undefined,
    onDelayed: () => delayed++,
    onTerminal: () => terminal++,
    setTimer: ((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length as any;
    }) as typeof setTimeout,
    clearTimer: (() => undefined) as typeof clearTimeout,
  });
  poller.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(delayed, 1);
  callbacks.shift()!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(terminal, 1);
  assert.equal(callbacks.length, 0);
});
