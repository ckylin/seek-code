// ── Evaluator Module (P/G/E Architecture) ────────────────────────────────────
// Pure structural evaluation — no LLM call.
//
// Checks:
//   1. Tool errors: any tool result starting with "Error:" or "Failed" → fail
//   2. Empty response: no tool calls AND no text output → fail
//   3. Blind write: write/edit without a prior read this session → warning only
//
// Rationale: LLM-based evaluation was too expensive (one extra call per step)
// and too inconsistent (same model evaluating its own output). Structural
// checks catch the real failure modes reliably and cheaply.

import type { LLMProvider, Message } from '../../types.js';
import type { PlanStep, EvaluationResult } from '../pipeline/types.js';
import { WRITE_TOOL_NAMES } from '../pipeline/types.js';
import { getLogger } from '../observability/logger.js';
import { getDefaultMetrics } from '../observability/metrics.js';

const log = getLogger('evaluator');

// ── Structural checks ─────────────────────────────────────────────────────

function structuralChecks(
  currentTurnToolCalls: Array<{ name: string; args: string }>,
  currentTurnToolResults: Array<{ content: string }>,
  sessionHasRead: boolean,
  assistantText: string,
): EvaluationResult {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let passed = true;
  let requiresRetry = false;
  let score = 90;

  // Check 1: Tool result errors — real failure, retry makes sense
  const hasToolError = currentTurnToolResults.some(tr => /^Error:|^Failed/.test(tr.content));
  if (hasToolError) {
    issues.push('工具调用返回了错误');
    suggestions.push('检查工具参数是否正确，文件路径是否存在');
    passed = false;
    requiresRetry = true;
    score -= 40;
  }

  // Check 2: Empty response — real failure, model produced nothing
  if (currentTurnToolCalls.length === 0 && !assistantText?.trim()) {
    issues.push('生成器未执行任何工具调用且无文本输出');
    suggestions.push('请重新执行该步骤');
    passed = false;
    requiresRetry = true;
    score -= 40;
  }

  // Check 3: Blind write — warning only, don't block progress
  const hasWrite = currentTurnToolCalls.some(tc => WRITE_TOOL_NAMES.has(tc.name));
  if (hasWrite && !sessionHasRead) {
    issues.push('写入操作前未读取文件，存在凭空编造代码的风险');
    suggestions.push('建议先用 read_file 了解现有代码再编辑');
    score -= 15;
    // passed stays true — this is a warning, not a blocker
  }

  return {
    passed,
    score: Math.max(0, score),
    issues,
    suggestions,
    requiresRetry,
  };
}

// ── Main Evaluation Function ──────────────────────────────────────────────

export interface EvaluateStepInput {
  planStep: PlanStep;
  messages: Message[];
  assistantText: string;
  /** True if any read_file call has occurred in this session (across all steps) */
  sessionHasRead: boolean;
  /** Tool calls made specifically in this generator turn */
  currentTurnToolCalls: Array<{ name: string; args: string }>;
  /** Tool results from this generator turn */
  currentTurnToolResults: Array<{ content: string }>;
  language: 'zh' | 'en';
  signal?: AbortSignal;
}

/**
 * Evaluate a generation step using structural checks only (no LLM call).
 * Fast, deterministic, and cheap — one evaluation per step.
 */
export async function evaluateStep(
  _provider: LLMProvider,
  _model: string,
  input: EvaluateStepInput,
): Promise<EvaluationResult> {
  const { planStep, assistantText, sessionHasRead, currentTurnToolCalls, currentTurnToolResults } = input;
  const metrics = getDefaultMetrics();
  const evalTimer = metrics.startTimer('evaluator.duration');

  log.info('Evaluating step (structural)', { stepId: planStep.id, description: planStep.description });

  const result = structuralChecks(currentTurnToolCalls, currentTurnToolResults, sessionHasRead, assistantText);

  evalTimer();
  metrics.increment('evaluator.calls');
  log.info('Evaluation complete', { passed: result.passed, score: result.score, issues: result.issues.length });

  return result;
}
