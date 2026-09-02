import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { ServerNotificationEnvelope } from "./generated/ServerNotificationEnvelope.js";
import type { ThreadStartResponse } from "./generated/v2/ThreadStartResponse.js";
import type { TurnStartResponse } from "./generated/v2/TurnStartResponse.js";
import type { Turn } from "./generated/v2/Turn.js";

type Pending = { resolve(value: unknown): void; reject(error: Error): void };
export class CodexAppServer {
  private child?: ChildProcessWithoutNullStreams;
  private requestId = 0;
  private pending = new Map<number, Pending>();
  private turns = new Map<string, Pending>();
  private deltas = new Map<
    string,
    { callback: (delta: string) => void; buffer: string }
  >();
  async start() {
    if (this.child) return;
    this.child = spawn(process.env.CODEX_BIN ?? "codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
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
          }
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
          }
        }
      } catch {
        /* stderr/log noise is not protocol */
      }
    });
    this.child.stderr.on("data", () => {
      /* Drain diagnostics so the app-server process cannot block on stderr. */
    });
    this.child.on("exit", () => {
      for (const p of this.pending.values())
        p.reject(new Error("Codex App Server exited"));
      for (const p of this.turns.values())
        p.reject(new Error("Codex App Server exited during a turn"));
      this.pending.clear();
      this.turns.clear();
      this.deltas.clear();
      this.child = undefined;
    });
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
      this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
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
    },
  ) {
    await this.start();
    const thread = threadId
      ? ((await this.request("thread/resume", {
          threadId,
        })) as ThreadStartResponse)
      : ((await this.request("thread/start", {
          cwd,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          ephemeral: false,
        })) as ThreadStartResponse);
    const id = thread.thread.id;
    await hooks?.onThread?.(id);
    const input: Array<Record<string, string>> = [
      { type: "text", text: prompt },
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
        buffer: "",
      });
    const completed = await new Promise<Turn>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turns.delete(started.turn.id);
        this.deltas.delete(started.turn.id);
        void this.request("turn/interrupt", {
          threadId: id,
          turnId: started.turn.id,
        }).catch(() => undefined);
        reject(new Error("Codex turn timed out"));
      }, 15 * 60_000);
      this.turns.set(started.turn.id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as Turn);
        },
        reject,
      });
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
    };
  }
}

export const codexAppServer = new CodexAppServer();
