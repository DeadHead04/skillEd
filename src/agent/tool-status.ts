// Modified for the skilled TypeScript distribution.
export const toolStatusSuccess = "success";
export const toolStatusError = "error";
import type { Transcript } from "../contracts/transcript.js";
/** Preserve Go transcript JSON omission rules without changing populated values. */
export function omitEmptyTranscriptFields(transcript: Transcript): Transcript {
  for (const message of transcript) {
    if (message.content === "") delete message.content;
    if (message.turn === 0) delete message.turn;
    if (message.tool_call) {
      if (message.tool_call.id === "") delete message.tool_call.id;
      if (
        message.tool_call.arguments &&
        Object.keys(message.tool_call.arguments).length === 0
      )
        delete message.tool_call.arguments;
    }
    if (message.tool_result) {
      if (message.tool_result.call_id === "")
        delete message.tool_result.call_id;
      if (message.tool_result.status === "") delete message.tool_result.status;
    }
  }
  return transcript;
}
