// Modified for the skilled TypeScript distribution.
export type Role =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "error"
  | (string & {});
export interface ToolCallInfo {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
}
export interface ToolResultInfo {
  call_id?: string;
  status?: string;
  content?: unknown;
  duration_ms?: number;
}
export interface Message {
  role: Role;
  content?: string;
  turn?: number;
  tool_call?: ToolCallInfo;
  tool_result?: ToolResultInfo;
  timestamp?: string;
}
export type Transcript = Message[];
export function finalAssistantMessage(transcript: Transcript): string {
  return transcript.findLast((m) => m.role === "assistant")?.content ?? "";
}
export function toolCalls(transcript: Transcript): Transcript {
  return transcript.filter((m) => m.role === "tool_call");
}
export function messagesForTurn(
  transcript: Transcript,
  turn: number,
): Transcript {
  return transcript.filter((m) => (m.turn ?? 0) === turn);
}
export function assistantMessagesForTurn(
  transcript: Transcript,
  turn: number,
): Transcript {
  return transcript.filter(
    (m) => m.role === "assistant" && (m.turn ?? 0) === turn,
  );
}
