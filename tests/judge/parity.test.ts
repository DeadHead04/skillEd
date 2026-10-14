import test from "node:test";
import assert from "node:assert/strict";
import { decode } from "../../src/contracts/decode.js";
import type { JudgeConfig, Expect } from "../../src/contracts/schema.js";
import {
  RuleBasedJudge,
  checkExpect,
  toAssertionResults,
  parseAgentJudgeResults,
  parseShebang,
  buildJudgePrompt,
} from "../../src/judge/index.js";
const cases: any[] = [
  [
    {
      op: "rule",
      config: { success: [{ output_contains: { all: ["alpha"] } }] },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains{all:[alpha]}",
            passed: true,
            evidence: "output satisfies all contains checks (all:[alpha])",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_contains: { any: ["alpha", "gamma"], not: ["beta"] } },
        ],
      },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: 'output_contains.not: "beta"',
            passed: false,
            evidence: 'output contains forbidden keyword "beta"',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_matches: { all: ["^[a-z]+"] } }] },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches{all:[^[a-z]+]}",
            passed: true,
            evidence: "output satisfies all regex checks (all:[^[a-z]+])",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_matches: { any: ["alpha", "ab[0-9]+"], not: ["gamma"] } },
        ],
      },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches{any:[alpha ab[0-9]+], not:[gamma]}",
            passed: true,
            evidence:
              "output satisfies all regex checks (any:[alpha ab[0-9]+], not:[gamma])",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ exit_code: 0 }] },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "exit_code: 0",
            passed: true,
            evidence: "exit_code is 0 as expected",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_contains: {} }] },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains",
            passed: true,
            evidence: "output satisfies all contains checks ()",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          {
            tool_called: {
              name: "write",
              args: { a: { x: 1, y: [true, null] } },
            },
          },
        ],
      },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called: write (with args)",
            passed: true,
            evidence: 'tool "write" was called with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_contains: { turn: 1, contains_all: ["alpha"] } },
        ],
      },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_contains[turn=1]{contains_all:[alpha]}",
            passed: true,
            evidence:
              "turn 1 response contains all required keywords (contains_all:[alpha])",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_not_contains: { turn: 2, not_contains: ["bad"] } },
        ],
      },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_not_contains[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { tool_called_in_turn: { turn: 1, name: "write", args: { a: 1 } } },
        ],
      },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called_in_turn[turn=1]: write (with args)",
            passed: true,
            evidence: 'tool "write" was called in turn 1 with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [{ tool_not_called_in_turn: { turn: 2, name: "write" } }],
      },
      input: {
        finalMessage: "alpha beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "alpha beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_not_called_in_turn[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_contains: { all: ["alpha"] } }] },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains.all: missing [alpha]",
            passed: false,
            evidence: "output does not contain required keywords: [alpha]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_contains: { any: ["alpha", "gamma"], not: ["beta"] } },
        ],
      },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains.any: [alpha gamma]",
            passed: false,
            evidence: "output does not contain any of [alpha gamma]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_matches: { all: ["^[a-z]+"] } }] },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches{all:[^[a-z]+]}",
            passed: true,
            evidence: "output satisfies all regex checks (all:[^[a-z]+])",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_matches: { any: ["alpha", "ab[0-9]+"], not: ["gamma"] } },
        ],
      },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches.any: [alpha ab[0-9]+]",
            passed: false,
            evidence: "output does not match any of [alpha ab[0-9]+]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ exit_code: 0 }] },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "exit_code: 0",
            passed: true,
            evidence: "exit_code is 0 as expected",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_contains: {} }] },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains",
            passed: true,
            evidence: "output satisfies all contains checks ()",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          {
            tool_called: {
              name: "write",
              args: { a: { x: 1, y: [true, null] } },
            },
          },
        ],
      },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called: write (with args)",
            passed: true,
            evidence: 'tool "write" was called with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_contains: { turn: 1, contains_all: ["alpha"] } },
        ],
      },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_contains[turn=1].contains_all[alpha]",
            passed: false,
            evidence:
              "turn 1 response missing required keywords: [alpha] (checked: [alpha])",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_not_contains: { turn: 2, not_contains: ["bad"] } },
        ],
      },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_not_contains[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { tool_called_in_turn: { turn: 1, name: "write", args: { a: 1 } } },
        ],
      },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called_in_turn[turn=1]: write (with args)",
            passed: true,
            evidence: 'tool "write" was called in turn 1 with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [{ tool_not_called_in_turn: { turn: 2, name: "write" } }],
      },
      input: {
        finalMessage: "beta",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "beta",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_not_called_in_turn[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_contains: { all: ["alpha"] } }] },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains.all: missing [alpha]",
            passed: false,
            evidence: "output does not contain required keywords: [alpha]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_contains: { any: ["alpha", "gamma"], not: ["beta"] } },
        ],
      },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains.any: [alpha gamma]",
            passed: false,
            evidence: "output does not contain any of [alpha gamma]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_matches: { all: ["^[a-z]+"] } }] },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches.all: missing [^[a-z]+]",
            passed: false,
            evidence:
              "output does not match required regex patterns: [^[a-z]+]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_matches: { any: ["alpha", "ab[0-9]+"], not: ["gamma"] } },
        ],
      },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches.any: [alpha ab[0-9]+]",
            passed: false,
            evidence: "output does not match any of [alpha ab[0-9]+]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ exit_code: 0 }] },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "exit_code: 0",
            passed: true,
            evidence: "exit_code is 0 as expected",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_contains: {} }] },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains",
            passed: true,
            evidence: "output satisfies all contains checks ()",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          {
            tool_called: {
              name: "write",
              args: { a: { x: 1, y: [true, null] } },
            },
          },
        ],
      },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called: write (with args)",
            passed: true,
            evidence: 'tool "write" was called with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_contains: { turn: 1, contains_all: ["alpha"] } },
        ],
      },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_contains[turn=1].contains_all[alpha]",
            passed: false,
            evidence:
              "turn 1 response missing required keywords: [alpha] (checked: [alpha])",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_not_contains: { turn: 2, not_contains: ["bad"] } },
        ],
      },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_not_contains[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { tool_called_in_turn: { turn: 1, name: "write", args: { a: 1 } } },
        ],
      },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called_in_turn[turn=1]: write (with args)",
            passed: true,
            evidence: 'tool "write" was called in turn 1 with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [{ tool_not_called_in_turn: { turn: 2, name: "write" } }],
      },
      input: {
        finalMessage: "",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_not_called_in_turn[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_contains: { all: ["alpha"] } }] },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains.all: missing [alpha]",
            passed: false,
            evidence: "output does not contain required keywords: [alpha]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_contains: { any: ["alpha", "gamma"], not: ["beta"] } },
        ],
      },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains.any: [alpha gamma]",
            passed: false,
            evidence: "output does not contain any of [alpha gamma]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_matches: { all: ["^[a-z]+"] } }] },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches{all:[^[a-z]+]}",
            passed: true,
            evidence: "output satisfies all regex checks (all:[^[a-z]+])",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_matches: { any: ["alpha", "ab[0-9]+"], not: ["gamma"] } },
        ],
      },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches{any:[alpha ab[0-9]+], not:[gamma]}",
            passed: true,
            evidence:
              "output satisfies all regex checks (any:[alpha ab[0-9]+], not:[gamma])",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ exit_code: 0 }] },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "exit_code: 0",
            passed: true,
            evidence: "exit_code is 0 as expected",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_contains: {} }] },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains",
            passed: true,
            evidence: "output satisfies all contains checks ()",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          {
            tool_called: {
              name: "write",
              args: { a: { x: 1, y: [true, null] } },
            },
          },
        ],
      },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called: write (with args)",
            passed: true,
            evidence: 'tool "write" was called with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_contains: { turn: 1, contains_all: ["alpha"] } },
        ],
      },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_contains[turn=1].contains_all[alpha]",
            passed: false,
            evidence:
              "turn 1 response missing required keywords: [alpha] (checked: [alpha])",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_not_contains: { turn: 2, not_contains: ["bad"] } },
        ],
      },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_not_contains[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { tool_called_in_turn: { turn: 1, name: "write", args: { a: 1 } } },
        ],
      },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called_in_turn[turn=1]: write (with args)",
            passed: true,
            evidence: 'tool "write" was called in turn 1 with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [{ tool_not_called_in_turn: { turn: 2, name: "write" } }],
      },
      input: {
        finalMessage: "ab12",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "ab12",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_not_called_in_turn[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_contains: { all: ["alpha"] } }] },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains.all: missing [alpha]",
            passed: false,
            evidence: "output does not contain required keywords: [alpha]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_contains: { any: ["alpha", "gamma"], not: ["beta"] } },
        ],
      },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains.any: [alpha gamma]",
            passed: false,
            evidence: "output does not contain any of [alpha gamma]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_matches: { all: ["^[a-z]+"] } }] },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches.all: missing [^[a-z]+]",
            passed: false,
            evidence:
              "output does not match required regex patterns: [^[a-z]+]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { output_matches: { any: ["alpha", "ab[0-9]+"], not: ["gamma"] } },
        ],
      },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_matches.any: [alpha ab[0-9]+]",
            passed: false,
            evidence: "output does not match any of [alpha ab[0-9]+]",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ exit_code: 0 }] },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "exit_code: 0",
            passed: true,
            evidence: "exit_code is 0 as expected",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: { success: [{ output_contains: {} }] },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "output_contains",
            passed: true,
            evidence: "output satisfies all contains checks ()",
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          {
            tool_called: {
              name: "write",
              args: { a: { x: 1, y: [true, null] } },
            },
          },
        ],
      },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called: write (with args)",
            passed: true,
            evidence: 'tool "write" was called with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_contains: { turn: 1, contains_all: ["alpha"] } },
        ],
      },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_contains[turn=1].contains_all[alpha]",
            passed: false,
            evidence:
              "turn 1 response missing required keywords: [alpha] (checked: [alpha])",
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { turn_response_not_contains: { turn: 2, not_contains: ["bad"] } },
        ],
      },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "turn_response_not_contains[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [
          { tool_called_in_turn: { turn: 1, name: "write", args: { a: 1 } } },
        ],
      },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "PASS",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_called_in_turn[turn=1]: write (with args)",
            passed: true,
            evidence: 'tool "write" was called in turn 1 with matching args',
          },
        ],
        summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
      },
    },
  ],
  [
    {
      op: "rule",
      config: {
        success: [{ tool_not_called_in_turn: { turn: 2, name: "write" } }],
      },
      input: {
        finalMessage: "\u00e9\ud83d\udc08",
        exitCode: 0,
        turnsExecuted: 1,
        turnsTotal: 2,
        transcript: [
          {
            role: "tool_call",
            tool_call: {
              name: "write",
              arguments: { a: { y: [true, null], x: 1 }, extra: "yes" },
            },
          },
        ],
        turnResults: [
          {
            turnNumber: 1,
            response: "\u00e9\ud83d\udc08",
            status: "completed",
            transcript: [
              {
                role: "tool_call",
                tool_call: { name: "write", arguments: { a: 1 } },
              },
            ],
          },
          { turnNumber: 2, status: "skipped", reason: "dependency" },
        ],
      },
    },
    {
      error: "",
      value: {
        status: "FAIL",
        turns_executed: 1,
        turns_total: 2,
        assertion_results: [
          {
            text: "tool_not_called_in_turn[turn=2]",
            passed: false,
            evidence:
              'turn 2 has status "skipped" (reason: dependency); assertion requires completed turn',
          },
        ],
        summary: { passed: 0, failed: 1, total: 1, pass_rate: 0 },
      },
    },
  ],
  [
    {
      op: "expect",
      config: { must_contain: ["alpha", "beta"] },
      input: { finalMessage: "alpha beta", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.must_contain",
          passed: true,
          evidence: "all checks passed",
        },
      ],
      value: {
        passed: true,
        failures: null,
        configured_rules: ["must_contain"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: { must_not_contain: ["alpha", "beta"] },
      input: { finalMessage: "alpha beta", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.must_not_contain",
          passed: false,
          evidence:
            'output contains forbidden keyword "alpha"; output contains forbidden keyword "beta"',
        },
      ],
      value: {
        passed: false,
        failures: [
          {
            rule: "must_not_contain",
            detail: 'output contains forbidden keyword "alpha"',
          },
          {
            rule: "must_not_contain",
            detail: 'output contains forbidden keyword "beta"',
          },
        ],
        configured_rules: ["must_not_contain"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: { exit_code: 1 },
      input: { finalMessage: "alpha beta", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.exit_code",
          passed: false,
          evidence: "expected exit_code 1, got 0",
        },
      ],
      value: {
        passed: false,
        failures: [
          { rule: "exit_code", detail: "expected exit_code 1, got 0" },
        ],
        configured_rules: ["exit_code"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: {
        must_contain: ["alpha"],
        must_not_contain: ["beta"],
        exit_code: 0,
      },
      input: { finalMessage: "alpha beta", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.must_contain",
          passed: true,
          evidence: "all checks passed",
        },
        {
          text: "expect.must_not_contain",
          passed: false,
          evidence: 'output contains forbidden keyword "beta"',
        },
        {
          text: "expect.exit_code",
          passed: true,
          evidence: "all checks passed",
        },
      ],
      value: {
        passed: false,
        failures: [
          {
            rule: "must_not_contain",
            detail: 'output contains forbidden keyword "beta"',
          },
        ],
        configured_rules: ["must_contain", "must_not_contain", "exit_code"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: {},
      input: { finalMessage: "alpha beta", exitCode: 0 },
    },
    {
      assertions: [],
      value: { passed: true, failures: null, configured_rules: null },
    },
  ],
  [
    {
      op: "expect",
      config: { must_contain: ["alpha", "beta"] },
      input: { finalMessage: "", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.must_contain",
          passed: false,
          evidence:
            'output does not contain "alpha"; output does not contain "beta"',
        },
      ],
      value: {
        passed: false,
        failures: [
          { rule: "must_contain", detail: 'output does not contain "alpha"' },
          { rule: "must_contain", detail: 'output does not contain "beta"' },
        ],
        configured_rules: ["must_contain"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: { must_not_contain: ["alpha", "beta"] },
      input: { finalMessage: "", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.must_not_contain",
          passed: true,
          evidence: "all checks passed",
        },
      ],
      value: {
        passed: true,
        failures: null,
        configured_rules: ["must_not_contain"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: { exit_code: 1 },
      input: { finalMessage: "", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.exit_code",
          passed: false,
          evidence: "expected exit_code 1, got 0",
        },
      ],
      value: {
        passed: false,
        failures: [
          { rule: "exit_code", detail: "expected exit_code 1, got 0" },
        ],
        configured_rules: ["exit_code"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: {
        must_contain: ["alpha"],
        must_not_contain: ["beta"],
        exit_code: 0,
      },
      input: { finalMessage: "", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.must_contain",
          passed: false,
          evidence: 'output does not contain "alpha"',
        },
        {
          text: "expect.must_not_contain",
          passed: true,
          evidence: "all checks passed",
        },
        {
          text: "expect.exit_code",
          passed: true,
          evidence: "all checks passed",
        },
      ],
      value: {
        passed: false,
        failures: [
          { rule: "must_contain", detail: 'output does not contain "alpha"' },
        ],
        configured_rules: ["must_contain", "must_not_contain", "exit_code"],
      },
    },
  ],
  [
    { op: "expect", config: {}, input: { finalMessage: "", exitCode: 0 } },
    {
      assertions: [],
      value: { passed: true, failures: null, configured_rules: null },
    },
  ],
  [
    {
      op: "expect",
      config: { must_contain: ["alpha", "beta"] },
      input: { finalMessage: "\u00e9", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.must_contain",
          passed: false,
          evidence:
            'output does not contain "alpha"; output does not contain "beta"',
        },
      ],
      value: {
        passed: false,
        failures: [
          { rule: "must_contain", detail: 'output does not contain "alpha"' },
          { rule: "must_contain", detail: 'output does not contain "beta"' },
        ],
        configured_rules: ["must_contain"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: { must_not_contain: ["alpha", "beta"] },
      input: { finalMessage: "\u00e9", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.must_not_contain",
          passed: true,
          evidence: "all checks passed",
        },
      ],
      value: {
        passed: true,
        failures: null,
        configured_rules: ["must_not_contain"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: { exit_code: 1 },
      input: { finalMessage: "\u00e9", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.exit_code",
          passed: false,
          evidence: "expected exit_code 1, got 0",
        },
      ],
      value: {
        passed: false,
        failures: [
          { rule: "exit_code", detail: "expected exit_code 1, got 0" },
        ],
        configured_rules: ["exit_code"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: {
        must_contain: ["alpha"],
        must_not_contain: ["beta"],
        exit_code: 0,
      },
      input: { finalMessage: "\u00e9", exitCode: 0 },
    },
    {
      assertions: [
        {
          text: "expect.must_contain",
          passed: false,
          evidence: 'output does not contain "alpha"',
        },
        {
          text: "expect.must_not_contain",
          passed: true,
          evidence: "all checks passed",
        },
        {
          text: "expect.exit_code",
          passed: true,
          evidence: "all checks passed",
        },
      ],
      value: {
        passed: false,
        failures: [
          { rule: "must_contain", detail: 'output does not contain "alpha"' },
        ],
        configured_rules: ["must_contain", "must_not_contain", "exit_code"],
      },
    },
  ],
  [
    {
      op: "expect",
      config: {},
      input: { finalMessage: "\u00e9", exitCode: 0 },
    },
    {
      assertions: [],
      value: { passed: true, failures: null, configured_rules: null },
    },
  ],
  [
    { op: "parse", criteria: ["test"], output: "null" },
    {
      error: "agent_judge: results is required and must be an array",
      value: null,
    },
  ],
  [
    { op: "parse", criteria: ["test"], output: "{}" },
    {
      error: "agent_judge: results is required and must be an array",
      value: null,
    },
  ],
  [
    { op: "parse", criteria: ["test"], output: '{"results": []}' },
    { error: "agent_judge: expected 1 criterion results, got 0", value: null },
  ],
  [
    {
      op: "parse",
      criteria: ["test"],
      output:
        '{"results": [{"criterion_id": "criterion-1", "passed": true, "evidence": [" seen "], "failures": []}]}',
    },
    {
      error: "",
      value: [
        {
          criterion_id: "criterion-1",
          passed: true,
          evidence: ["seen"],
          failures: [],
        },
      ],
    },
  ],
  [
    {
      op: "parse",
      criteria: ["test"],
      output:
        '{"results": [{"criterion_id": "criterion-1", "passed": false, "evidence": [" seen "], "failures": [" missing "]}]}',
    },
    {
      error: "",
      value: [
        {
          criterion_id: "criterion-1",
          passed: false,
          evidence: ["seen"],
          failures: ["missing"],
        },
      ],
    },
  ],
  [
    {
      op: "parse",
      criteria: ["test"],
      output:
        '{"results": [{"criterion_id": "criterion-1", "passed": true, "evidence": [], "failures": []}]}',
    },
    {
      error: 'agent_judge: criterion "criterion-1" has empty evidence',
      value: null,
    },
  ],
  [
    {
      op: "parse",
      criteria: ["test"],
      output:
        '{"results": [{"criterion_id": "wrong", "passed": true, "evidence": [" seen "], "failures": []}]}',
    },
    {
      error: 'agent_judge: result 1 has unknown criterion_id "wrong"',
      value: null,
    },
  ],
  [
    {
      op: "parse",
      criteria: ["test"],
      output:
        '{"results": [{"criterion_id": "criterion-1", "passed": null, "evidence": [" seen "], "failures": []}]}',
    },
    {
      error: 'agent_judge: criterion "criterion-1" is missing passed',
      value: null,
    },
  ],
  [
    {
      op: "parse",
      criteria: ["test"],
      output:
        '{"results": [{"criterion_id": "criterion-1", "passed": true, "evidence": [" seen "], "failures": null}]}',
    },
    {
      error: 'agent_judge: criterion "criterion-1" is missing failures',
      value: null,
    },
  ],
  [
    {
      op: "parse",
      criteria: ["test"],
      output:
        '{"results": [{"criterion_id": "criterion-1", "passed": false, "evidence": [" seen "], "failures": []}]}',
    },
    {
      error:
        'agent_judge: criterion "criterion-1" failed but reported no failures',
      value: null,
    },
  ],
  [
    { op: "shebang", body: "/bin/bash -eu" },
    { interpreter: "bash", options: ["-eu"] },
  ],
  [
    { op: "shebang", body: "/usr/bin/env bash -eu" },
    { interpreter: "bash", options: ["-eu"] },
  ],
  [
    { op: "shebang", body: '/usr/bin/env -S bash -c "echo ok"' },
    { interpreter: "bash", options: ["-c", "echo ok"] },
  ],
  [
    { op: "shebang", body: "/usr/bin/env -Sbash -eu" },
    { interpreter: "bash", options: ["-eu"] },
  ],
  [
    { op: "shebang", body: "/usr/bin/env --split-string=bash -eu" },
    { interpreter: "bash", options: ["-eu"] },
  ],
  [
    { op: "shebang", body: "/usr/bin/env -u VAR -C /tmp bash" },
    { interpreter: "bash", options: [] },
  ],
  [
    { op: "shebang", body: "/usr/bin/env --ignore-signal bash" },
    { interpreter: "bash", options: [] },
  ],
  [
    { op: "shebang", body: "/usr/bin/env -S bash\\_-eu" },
    { interpreter: "bash", options: ["-eu"] },
  ],
  [
    { op: "shebang", body: "/usr/bin/env -S bash\\c ignored" },
    { interpreter: "bash", options: [] },
  ],
  [
    { op: "shebang", body: '/usr/bin/env -S "unterminated' },
    { interpreter: "", options: null },
  ],
  [
    { op: "shebang", body: "/usr/bin/env FOO=bar bash -eu" },
    { interpreter: "bash", options: ["-eu"] },
  ],
  [
    { op: "shebang", body: "/bin/pwsh -NoLogo" },
    { interpreter: "pwsh", options: ["-NoLogo"] },
  ],
  [
    { op: "prompt", criteria: [] },
    'You are an expert evaluator for an AI agent skill evaluation.\nYou must assess the agent\'s output against the following criteria.\nFor EACH criterion, you MUST provide:\n- "criterion_id": the exact stable ID shown below\n- "passed": true/false\n- "evidence": a non-empty JSON array of concrete observations supporting your judgment\n- "failures": an empty JSON array when passed is true, otherwise a non-empty array of unmet requirements\n\nYou MUST NOT pass a criterion without specific evidence.\nThe exact output contract is stated near the end of this prompt under "Required Output Contract"; your final message MUST satisfy it verbatim.\n\n## Criteria\n\n## Required Output Contract\n- Allowed root field: results.\n- Required result fields with exact casing: criterion_id, passed, evidence, failures.\n- Use every configured criterion_id exactly once.\n- Evidence must be a non-empty string array. Failures must be empty when passed is true and non-empty when passed is false.\n- Your FINAL message must contain ONLY the JSON object, even after you have invoked judge Skills or read the review materials. It must begin with \'{\' and end with \'}\'. Wrapping that single object in one ```json code fence is also accepted.\n- Do NOT begin the final message with any prose, preamble, acknowledgement, or narration (for example "I", "Sure", "Here is", "Based on"). Do NOT add any commentary, explanation, or extra fields before or after the JSON.\n- Escape double quotes inside string values (e.g. \\"example\\").\n\n## Required Response Format (JSON)\nUse each criterion_id exactly once. Set passed and the arrays according to your judgment.\n```json\n{\n  "results": [\n  ]\n}\n```\n',
  ],
  [
    { op: "prompt", criteria: ["x"] },
    'You are an expert evaluator for an AI agent skill evaluation.\nYou must assess the agent\'s output against the following criteria.\nFor EACH criterion, you MUST provide:\n- "criterion_id": the exact stable ID shown below\n- "passed": true/false\n- "evidence": a non-empty JSON array of concrete observations supporting your judgment\n- "failures": an empty JSON array when passed is true, otherwise a non-empty array of unmet requirements\n\nYou MUST NOT pass a criterion without specific evidence.\nThe exact output contract is stated near the end of this prompt under "Required Output Contract"; your final message MUST satisfy it verbatim.\n\n## Criteria\n[criterion-1] x\n\n## Required Output Contract\n- Allowed root field: results.\n- Required result fields with exact casing: criterion_id, passed, evidence, failures.\n- Use every configured criterion_id exactly once.\n- Evidence must be a non-empty string array. Failures must be empty when passed is true and non-empty when passed is false.\n- Your FINAL message must contain ONLY the JSON object, even after you have invoked judge Skills or read the review materials. It must begin with \'{\' and end with \'}\'. Wrapping that single object in one ```json code fence is also accepted.\n- Do NOT begin the final message with any prose, preamble, acknowledgement, or narration (for example "I", "Sure", "Here is", "Based on"). Do NOT add any commentary, explanation, or extra fields before or after the JSON.\n- Escape double quotes inside string values (e.g. \\"example\\").\n\n## Required Response Format (JSON)\nUse each criterion_id exactly once. Set passed and the arrays according to your judgment.\n```json\n{\n  "results": [\n    {"criterion_id": "criterion-1", "passed": true, "evidence": ["concrete observation"], "failures": []}\n  ]\n}\n```\n',
  ],
  [
    { op: "prompt", criteria: ["x", "y"] },
    'You are an expert evaluator for an AI agent skill evaluation.\nYou must assess the agent\'s output against the following criteria.\nFor EACH criterion, you MUST provide:\n- "criterion_id": the exact stable ID shown below\n- "passed": true/false\n- "evidence": a non-empty JSON array of concrete observations supporting your judgment\n- "failures": an empty JSON array when passed is true, otherwise a non-empty array of unmet requirements\n\nYou MUST NOT pass a criterion without specific evidence.\nThe exact output contract is stated near the end of this prompt under "Required Output Contract"; your final message MUST satisfy it verbatim.\n\n## Criteria\n[criterion-1] x\n[criterion-2] y\n\n## Required Output Contract\n- Allowed root field: results.\n- Required result fields with exact casing: criterion_id, passed, evidence, failures.\n- Use every configured criterion_id exactly once.\n- Evidence must be a non-empty string array. Failures must be empty when passed is true and non-empty when passed is false.\n- Your FINAL message must contain ONLY the JSON object, even after you have invoked judge Skills or read the review materials. It must begin with \'{\' and end with \'}\'. Wrapping that single object in one ```json code fence is also accepted.\n- Do NOT begin the final message with any prose, preamble, acknowledgement, or narration (for example "I", "Sure", "Here is", "Based on"). Do NOT add any commentary, explanation, or extra fields before or after the JSON.\n- Escape double quotes inside string values (e.g. \\"example\\").\n\n## Required Response Format (JSON)\nUse each criterion_id exactly once. Set passed and the arrays according to your judgment.\n```json\n{\n  "results": [\n    {"criterion_id": "criterion-1", "passed": true, "evidence": ["concrete observation"], "failures": []},\n    {"criterion_id": "criterion-2", "passed": true, "evidence": ["concrete observation"], "failures": []}\n  ]\n}\n```\n',
  ],
];
test("captured original Go judge corpus (95 vectors)", async () => {
  for (const [r, expected] of cases) {
    let actual: any;
    if (r.op === "rule")
      actual = {
        value: await new RuleBasedJudge(
          decode<JudgeConfig>("JudgeConfig", r.config),
        ).evaluate(r.input),
        error: "",
      };
    else if (r.op === "expect") {
      const value = await checkExpect(
        decode<Expect>("Expect", r.config),
        r.input,
      );
      actual = { value, assertions: toAssertionResults(value) };
    } else if (r.op === "parse") {
      try {
        actual = {
          value: parseAgentJudgeResults(r.criteria, r.output),
          error: "",
        };
      } catch (e) {
        actual = { value: null, error: (e as Error).message };
      }
    } else if (r.op === "shebang") {
      actual = parseShebang(r.body);
      expected.options ??= [];
    } else actual = buildJudgePrompt(r.criteria, null);
    // Stable scoring provenance is additive to the pinned reference corpus.
    // Negative-rule and gate semantic changes have separate real-process tests.
    const legacy = JSON.parse(JSON.stringify(actual, (key, value) =>
      ["id", "scoring_version", "rubric_id"].includes(key) ? undefined : value));
    assert.deepEqual(legacy, expected, JSON.stringify(r));
  }
});
