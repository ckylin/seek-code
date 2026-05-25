// ── Evaluator Module (P/G/E Architecture) ──────────────────────────────────
// Evaluates the output of a generation step against the plan step definition.
// Uses a separate LLM call (no tools) to perform quality assessment.
//
// DeepSeek adaptation:
// - Simple PASS/FAIL with structured JSON output
// - Explicit anti-hallucination checks (reads before writes?)
// - Score-based to distinguish "minor issues" from "needs retry"
// - Fallback to PASS on evaluation failure (avoid blocking progress)
//
// Ref: Anthropic Harness P/G/E pattern — Evaluator stage
// Ref: pipeline/types.ts for EvaluationResult interface

import type { LLMProvider, Message } from '../../types.js';
import type { PlanStep, EvaluationResult } from '../pipeline/types.js';
import { READ_TOOL_NAMES, WRITE_TOOL_NAMES } from '../pipeline/types.js';
import { getLogger } from '../observability/logger.js';
import { getDefaultMetrics } from '../observability/metrics.js';
import { getDefaultEventBus, type LLMRequestEvent } from '../events/bus.js';

const log = getLogger('evaluator');

// ── Evaluator System Prompt (DeepSeek-optimized) ─────────────────────────

function buildEvaluatorPrompt(
  language: 'zh' | 'en',
  planStep: PlanStep,
  generatorOutput: string,
  toolCallsSummary: string,
  conversationSummary: string,
): string {
  const formatInstruction = language === 'zh'
    ? `你是一个代码质量评估专家。根据以下信息，评估生成器是否按照计划步骤正确完成了任务。

## 计划步骤
- **描述**: ${planStep.description}
- **期望结果**: ${planStep.expectedOutcome}
- **验证方式**: ${planStep.verification}

## 生成器输出
${generatorOutput.slice(0, 2000) || '(无文本输出 — 仅执行了工具调用)'}

## 工具调用记录
${toolCallsSummary.slice(0, 1500) || '(无工具调用)'}

## 对话摘要
${conversationSummary.slice(0, 1000)}

## 特殊情况（优先判断）
- 如果步骤是"列出/查找/搜索/浏览"类任务，工具调用结果本身即为输出，**不要求额外的文本摘要**
- 如果步骤是"读取文件/收集信息"类准备步骤，成功读取文件即视为完成，不要求输出提取结果
- 如果步骤是"更新/编辑/写入文件"类任务，必须有 write_file 或 edit_file 工具调用才算完成；仅有文本输出而无写入操作应判 passed=false
- 如果步骤是"分析/对比/生成报告"类任务，有文本输出即视为完成，不要求工具调用
- 如果工具调用成功且结果包含所需信息，即使没有文本输出也应 passed=true，score >= 75
- 只有当工具调用失败或结果明显不符合期望时才降分

## 评估标准
1. **计划遵循**: 生成器的输出是否达成了计划步骤的目标？
2. **文件读取**: 如果执行了写入/编辑操作，是否先读取了相关文件？
3. **幻觉检测**: 是否引用了不存在的文件、API、类型或配置？
4. **完整性**: 步骤的关键操作是否都已完成？
5. **错误处理**: 是否有被忽略的错误？

## 输出格式（严格遵守）
将评估放在 JSON 代码块中：

\`\`\`json
{
  "passed": true,
  "score": 85,
  "issues": ["小问题描述"],
  "suggestions": ["改进建议"],
  "requiresRetry": false
}
\`\`\`

## 评分指南
- 90-100: 完美执行，无问题
- 70-89: 有小问题但不影响整体，passed=true
- 50-69: 有重要问题，建议重试，passed=false
- 0-49: 严重错误或幻觉，必须重试，passed=false
- requiresRetry: score < 70 时为 true`

    : `You are a code quality evaluator. Assess whether the generator correctly completed the plan step based on the following information.

## Plan Step
- **Description**: ${planStep.description}
- **Expected Outcome**: ${planStep.expectedOutcome}
- **Verification**: ${planStep.verification}

## Generator Output
${generatorOutput.slice(0, 2000) || '(No text output — tool calls only)'}

## Tool Call Record
${toolCallsSummary.slice(0, 1500) || '(No tool calls)'}

## Conversation Summary
${conversationSummary.slice(0, 1000)}

## Special Cases (evaluate first)
- If the step is a "list/find/search/browse" task, tool call results ARE the output — **no text summary required**
- If the step is a "read files/gather information" preparation step, successfully reading files counts as done — no extracted output required
- If the step is an "update/edit/write files" task, write_file or edit_file tool calls are REQUIRED; text-only output without writes should be passed=false
- If the step is an "analyze/compare/generate report" task, text output counts as done — no tool calls required
- If tool calls succeeded and results contain the needed information, passed=true with score >= 75, even with no text output
- Only penalize if tool calls failed or results clearly don't match the expected outcome

## Evaluation Criteria
1. **Plan Adherence**: Did the generator output achieve the plan step goal?
2. **File Reading**: If write/edit was performed, were relevant files read first?
3. **Hallucination Detection**: Were non-existent files, APIs, types, or configs referenced?
4. **Completeness**: Are all key operations complete?
5. **Error Handling**: Are there any ignored errors?

## Output Format (follow strictly)
Place your evaluation in a JSON code block:

\`\`\`json
{
  "passed": true,
  "score": 85,
  "issues": ["minor issue description"],
  "suggestions": ["improvement suggestion"],
  "requiresRetry": false
}
\`\`\`

## Scoring Guide
- 90-100: Perfect execution, no issues
- 70-89: Minor issues but overall acceptable, passed=true
- 50-69: Significant issues, recommend retry, passed=false
- 0-49: Critical errors or hallucinations, must retry, passed=false
- requiresRetry: true when score < 70`;

  return formatInstruction;
}

// ── Evaluation Parsing ────────────────────────────────────────────────────

function extractJsonBlock(text: string): string | null {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match) return match[1].trim();
  const objMatch = text.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (objMatch) return objMatch[0].trim();
  return null;
}

function parseEvaluation(raw: string): EvaluationResult {
  const jsonStr = extractJsonBlock(raw);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr) as EvaluationResult;
      return {
        passed: Boolean(parsed.passed),
        score: Math.max(0, Math.min(100, Number(parsed.score) || 70)),
        issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
        requiresRetry: Boolean(parsed.requiresRetry ?? !parsed.passed),
      };
    } catch {
      log.warn('Evaluation JSON parse failed, using heuristic fallback');
    }
  }

  // Heuristic fallback: check for PASS/FAIL keywords
  const lowerRaw = raw.toLowerCase();
  const isPass = lowerRaw.includes('"passed": true') || lowerRaw.includes('passed: true');
  const isFail = lowerRaw.includes('"passed": false') || lowerRaw.includes('passed: false');

  return {
    passed: isPass && !isFail,
    score: isPass ? 75 : 50,
    issues: [],
    suggestions: [],
    requiresRetry: isFail,
  };
}

// ── Structural checks (no LLM needed) ─────────────────────────────────────

function structuralChecks(
  currentTurnToolCalls: Array<{ name: string; args: string }>,
  currentTurnToolResults: Array<{ content: string }>,
  hasReadThisTurn: boolean,
  assistantText: string,
): { issues: string[]; scorePenalty: number } {
  const issues: string[] = [];
  let penalty = 0;

  // Check 1: Blind write detection
  const hasWrite = currentTurnToolCalls.some(tc => tc.name === 'write_file' || tc.name === 'edit_file');
  if (hasWrite && !hasReadThisTurn) {
    issues.push('检测到写入操作但未先读取文件——存在凭空编造代码的风险');
    penalty += 25;
  }

  // Check 2: Error in tool results — only flag tool-level errors, not code content
  const toolResultErrors = currentTurnToolCalls
    .map((_, i) => currentTurnToolResults[i]?.content ?? '')
    .some(content => /^Error:|^Failed/.test(content));
  if (toolResultErrors) {
    issues.push('工具调用返回了错误');
    penalty += 20;
  }

  // Check 3: No tool calls AND no text output — truly empty response
  if (currentTurnToolCalls.length === 0 && !assistantText?.trim()) {
    issues.push('生成器未执行任何工具调用且无文本输出');
    penalty += 20;
  }

  return { issues, scorePenalty: Math.min(100, penalty) };
}

// ── Build tool summary from current-turn data only ────────────────────────

function buildToolCallsSummary(
  currentTurnToolCalls: Array<{ name: string; args: string }>,
  currentTurnToolResults: Array<{ content: string }>,
): string {
  if (currentTurnToolCalls.length === 0) return '(无工具调用)';
  const parts: string[] = [];
  for (const tc of currentTurnToolCalls) {
    parts.push(`[tool_call] ${tc.name}(${tc.args.slice(0, 150)})`);
  }
  for (const tr of currentTurnToolResults) {
    const preview = tr.content.length > 200 ? tr.content.slice(0, 200) + '…' : tr.content;
    parts.push(`[tool_result] ${preview}`);
  }
  return parts.join('\n');
}

// ── Build conversation summary ────────────────────────────────────────────

function buildConversationSummary(messages: Message[]): string {
  const recentMsgs = messages.slice(-6); // Last 6 messages
  return recentMsgs.map(m => {
    if (m.role === 'user' && 'content' in m) {
      return `[user] ${String(m.content).slice(0, 150)}`;
    }
    if (m.role === 'assistant' && 'content' in m && m.content) {
      return `[assistant] ${String(m.content).slice(0, 150)}`;
    }
    if (m.role === 'assistant' && 'tool_calls' in m) {
      return `[assistant:tool_calls] ${m.tool_calls?.length ?? 0} calls`;
    }
    if (m.role === 'tool') {
      const preview = String(m.content).slice(0, 100);
      return `[tool_result] ${preview}`;
    }
    return `[${m.role}]`;
  }).join('\n');
}

// ── Main Evaluation Function ──────────────────────────────────────────────

export interface EvaluateStepInput {
  planStep: PlanStep;
  messages: Message[];
  assistantText: string;
  hasReadThisTurn: boolean;
  /** Tool calls made specifically in this generator turn */
  currentTurnToolCalls: Array<{ name: string; args: string }>;
  /** Tool results from this generator turn */
  currentTurnToolResults: Array<{ content: string }>;
  language: 'zh' | 'en';
  signal?: AbortSignal;
}

/**
 * Evaluate a generation step against the plan. Combines structural
 * checks (no LLM) with LLM-based quality assessment for DeepSeek.
 */
export async function evaluateStep(
  provider: LLMProvider,
  model: string,
  input: EvaluateStepInput,
): Promise<EvaluationResult> {
  const { planStep, messages, assistantText, hasReadThisTurn, currentTurnToolCalls, currentTurnToolResults, language, signal } = input;
  const metrics = getDefaultMetrics();
  const bus = getDefaultEventBus();
  const evalTimer = metrics.startTimer('evaluator.duration');

  log.info('Evaluating step', { stepId: planStep.id, description: planStep.description });

  const toolCallsSummary = buildToolCallsSummary(currentTurnToolCalls, currentTurnToolResults);
  const conversationSummary = buildConversationSummary(messages);

  // ── Phase 1: Structural checks (fast, no LLM) ────────────────────────
  const structural = structuralChecks(currentTurnToolCalls, currentTurnToolResults, hasReadThisTurn, assistantText);

  // If structural issues are severe, skip LLM evaluation
  if (structural.scorePenalty >= 40) {
    evalTimer();
    log.warn('Structural evaluation determined failure', { penalty: structural.scorePenalty });
    return {
      passed: false,
      score: Math.max(0, 80 - structural.scorePenalty),
      issues: structural.issues,
      suggestions: ['请先使用 read_file 了解相关代码再编辑'],
      requiresRetry: true,
    };
  }

  // ── Phase 2: LLM-based evaluation ────────────────────────────────────
  const systemPrompt = buildEvaluatorPrompt(
    language,
    planStep,
    assistantText,
    toolCallsSummary,
    conversationSummary,
  );

  const llmMessages: Message[] = [
    { role: 'user', content: systemPrompt },
  ];

  bus.emit({
    type: 'llm:request',
    model: 'evaluator',
    messageCount: 1,
    estimatedTokens: Math.ceil(systemPrompt.length / 4),
    timestamp: Date.now(),
  } as LLMRequestEvent);

  try {
    let fullText = '';
    const stream = provider.stream(llmMessages, {
      model: model,
      maxTokens: 1024,
      temperature: 0.1,
      signal,
    });

    for await (const chunk of stream) {
      if (signal?.aborted) break;
      if (chunk.type === 'text_delta') {
        fullText += chunk.text;
      } else if (chunk.type === 'finish') {
        break;
      }
    }

    evalTimer();
    metrics.increment('evaluator.calls');

    const llmEval = parseEvaluation(fullText);

    // Merge structural issues
    const allIssues = [...structural.issues, ...llmEval.issues];
    const finalScore = Math.max(0, llmEval.score - structural.scorePenalty);

    const result: EvaluationResult = {
      passed: llmEval.passed && structural.scorePenalty < 30,
      score: finalScore,
      issues: allIssues,
      suggestions: llmEval.suggestions,
      requiresRetry: llmEval.requiresRetry || structural.scorePenalty >= 30,
    };

    log.info('Evaluation complete', {
      passed: result.passed,
      score: result.score,
      issues: result.issues.length,
    });

    return result;
  } catch (err) {
    evalTimer();
    log.error('LLM evaluation failed, using structural result', {
      error: err instanceof Error ? err.message : String(err),
    });
    metrics.increment('evaluator.errors');

    // Fall back to structural evaluation result
    return {
      passed: structural.scorePenalty < 30,
      score: Math.max(0, 80 - structural.scorePenalty),
      issues: structural.issues,
      suggestions: [],
      requiresRetry: structural.scorePenalty >= 30,
    };
  }
}
