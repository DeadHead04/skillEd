import { serviceEndpoint } from "@skilled/core";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { ServerNotificationEnvelope } from "./generated/ServerNotificationEnvelope.js";
import type { ThreadStartResponse } from "./generated/v2/ThreadStartResponse.js";
import type { TurnStartResponse } from "./generated/v2/TurnStartResponse.js";
import type { Turn } from "./generated/v2/Turn.js";
import { remoteExecution } from "./remote-execution.js";
import { relative } from "node:path";
import { executionEnvironment, signalTree } from "./process.js";

type Pending = { resolve(value: unknown): void; reject(error: Error): void };
export class CodexAppServer {
  constructor(private readonly timeouts = { rpc: 30_000, turn: 15 * 60_000 }) {}
  private child?: ChildProcessWithoutNullStreams;
  private requestId = 0;
  private pending = new Map<number, Pending>();
  private turns = new Map<string, Pending>();
  private completedTurns = new Map<string, Turn>();
  private earlyDeltas = new Map<string, string>();
  private deltas = new Map<
    string,
    { callback: (delta: string) => void; buffer: string }
  >();
  async start() {
    if (this.child) return;
    this.child = spawn(process.env.CODEX_BIN ?? "codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: executionEnvironment(),
      detached: process.platform !== "win32",
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id != null) {
          const pending = this.pending.get(Number(message.id));
          if (!pending) return;
          this.pending.delete(Number(message.id));
          message.error
            ? pending.reject(new Error(message.error.message))
            : pending.resolve(message.result);
          return;
        }
        const notification = message as ServerNotificationEnvelope;
        if (notification.method === "item/agentMessage/delta") {
          const stream = this.deltas.get(notification.params.turnId);
          if (stream) {
            stream.buffer += notification.params.delta;
            if (stream.buffer.length >= 512) {
              const chunk = stream.buffer;
              stream.buffer = "";
              if (chunk.trim()) stream.callback(chunk);
            }
          } else
            this.earlyDeltas.set(
              notification.params.turnId,
              (
                (this.earlyDeltas.get(notification.params.turnId) ?? "") +
                notification.params.delta
              ).slice(-64_000),
            );
        }
        if (notification.method === "turn/completed") {
          const waiting = this.turns.get(notification.params.turn.id);
          if (waiting) {
            this.turns.delete(notification.params.turn.id);
            const stream = this.deltas.get(notification.params.turn.id);
            if (stream?.buffer.trim()) stream.callback(stream.buffer);
            this.deltas.delete(notification.params.turn.id);
            notification.params.turn.error
              ? waiting.reject(
                  new Error(
                    notification.params.turn.error.message ??
                      "Codex turn failed",
                  ),
                )
              : waiting.resolve(notification.params.turn);
          } else
            this.completedTurns.set(
              notification.params.turn.id,
              notification.params.turn,
            );
        }
      } catch {
        /* stderr/log noise is not protocol */
      }
    });
    this.child.stderr.on("data", () => {
      /* Drain diagnostics so the app-server process cannot block on stderr. */
    });
    const failed = () => {
      for (const p of this.pending.values())
        p.reject(new Error("Codex App Server exited"));
      for (const p of this.turns.values())
        p.reject(new Error("Codex App Server exited during a turn"));
      this.pending.clear();
      this.turns.clear();
      this.deltas.clear();
      this.completedTurns.clear();
      this.earlyDeltas.clear();
      this.child = undefined;
    };
    this.child.on("exit", failed);
    this.child.on("error", failed);
    await this.request("initialize", {
      clientInfo: {
        name: "skilled-worker",
        title: "SkillEd worker",
        version: "0.1.0",
      },
      capabilities: {},
    });
    this.child.stdin.write(
      `${JSON.stringify({ method: "initialized", params: {} })}\n`,
    );
  }
  request(method: string, params: unknown) {
    const id = ++this.requestId;
    return new Promise<unknown>((resolve, reject) => {
      if (!this.child?.stdin.writable) {
        reject(new Error("Codex App Server is unavailable"));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`App Server request timed out: ${method}`));
      }, this.timeouts.rpc);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(
        `${JSON.stringify({ id, method, params })}\n`,
        (error) => {
          if (error) {
            this.pending.get(id)?.reject(error);
            this.pending.delete(id);
          }
        },
      );
    });
  }
  async structuredTurn(
    cwd: string,
    prompt: string,
    outputSchema: unknown,
    threadId?: string,
    hooks?: {
      onThread?: (threadId: string) => Promise<void> | void;
      onDelta?: (delta: string) => Promise<void> | void;
      skill?: { name: string; path: string };
      recoveryContext?: string;
    },
  ) {
    if (serviceEndpoint("EXECUTOR")) {
      const result = await remoteExecution(
        cwd,
        {
          kind: "appServer",
          prompt,
          outputSchema,
          threadId,
          recoveryContext: hooks?.recoveryContext,
          skillPath: hooks?.skill ? relative(cwd, hooks.skill.path) : undefined,
        },
        hooks?.onDelta,
      );
      await hooks?.onThread?.(result.threadId);
      return result as {
        threadId: string;
        turn: Turn;
        text: string;
        structured: unknown;
        reconstructed: boolean;
      };
    }
    await this.start();
    const startThread = async () =>
      (await this.request("thread/start", {
        cwd,
        approvalPolicy: "never",
        sandbox: "workspace-write",
        ephemeral: false,
      })) as ThreadStartResponse;
    let thread: ThreadStartResponse;
    let reconstructed = false;
    if (threadId) {
      try {
        thread = (await this.request("thread/resume", {
          threadId,
        })) as ThreadStartResponse;
      } catch (error) {
        if (
          !hooks?.recoveryContext ||
          !/not found|unknown thread|failed to load|does not exist/i.test(
            String(error),
          )
        )
          throw error;
        thread = await startThread();
        reconstructed = true;
        hooks.onDelta?.(
          "Conversation reconstructed from saved completed messages.\n",
        );
      }
    } else {
      thread = await startThread();
      reconstructed = Boolean(
        hooks?.recoveryContext && hooks.recoveryContext !== "[]",
      );
      if (reconstructed)
        await hooks?.onDelta?.(
          "Conversation reconstructed from saved completed messages.\n",
        );
    }
    const id = thread.thread.id;
    await hooks?.onThread?.(id);
    const input: Array<Record<string, string>> = [
      {
        type: "text",
        text: reconstructed
          ? `Completed conversation context (reconstructed):\n${hooks?.recoveryContext}\n\nCurrent request:\n${prompt}`
          : prompt,
      },
    ];
    if (hooks?.skill) {
      input.push({
        type: "skill",
        name: hooks.skill.name,
        path: hooks.skill.path,
      });
    }
    const started = (await this.request("turn/start", {
      threadId: id,
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      },
      input,
      outputSchema,
    })) as TurnStartResponse;
    if (hooks?.onDelta)
      this.deltas.set(started.turn.id, {
        callback: (delta) => void hooks.onDelta?.(delta),
        buffer: this.earlyDeltas.get(started.turn.id) ?? "",
      });
    this.earlyDeltas.delete(started.turn.id);
    const completed = await new Promise<Turn>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turns.delete(started.turn.id);
        this.deltas.delete(started.turn.id);
        void this.request("turn/interrupt", {
          threadId: id,
          turnId: started.turn.id,
        }).catch(() => undefined);
        reject(new Error("Codex turn timed out"));
      }, this.timeouts.turn);
      this.turns.set(started.turn.id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as Turn);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      const early = this.completedTurns.get(started.turn.id);
      if (early) {
        this.completedTurns.delete(started.turn.id);
        const pending = this.turns.get(started.turn.id)!;
        this.turns.delete(started.turn.id);
        const stream = this.deltas.get(started.turn.id);
        if (stream?.buffer.trim()) stream.callback(stream.buffer);
        this.deltas.delete(started.turn.id);
        early.error
          ? pending.reject(new Error(early.error.message))
          : pending.resolve(early);
      }
    });
    const text = completed.items
      .filter((item) => item.type === "agentMessage")
      .map((item) => item.text)
      .join("\n");
    return {
      threadId: id,
      turn: completed,
      text,
      structured: JSON.parse(text) as unknown,
      reconstructed,
    };
  }
  async stop() {
    if (!this.child) return;
    const child = this.child;
    signalTree(child, "SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signalTree(child, "SIGKILL");
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export const codexAppServer = new CodexAppServer();
