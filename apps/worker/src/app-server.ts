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
        if (notification.method === "turn/completed") {
          const waiting = this.turns.get(notification.params.turn.id);
          if (waiting) {
            this.turns.delete(notification.params.turn.id);
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
    this.child.on("exit", () => {
      for (const p of this.pending.values())
        p.reject(new Error("Codex App Server exited"));
      this.pending.clear();
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
      input: [{ type: "text", text: prompt }],
      outputSchema,
    })) as TurnStartResponse;
    const completed = await new Promise<Turn>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turns.delete(started.turn.id);
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
