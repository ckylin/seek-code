// ── Stage 4: Post Process ───────────────────────────────────────────────────
// Handles the finalization of a turn:
// - Pushes final assistant text message to context if stop/length
// - Detects truncation warnings (finishReason === 'length')
// - Determines whether to continue looping or stop
//
// Ref: Original post-processing logic from src/core/agent/loop.ts
// (finishReason handling, assistant text push, truncation warning)

import type { Stage, StageResult, PipelineContext } from '../types.js';
import { getLogger } from '../../observability/logger.js';

const log = getLogger('stage:post-process');

export class PostProcessStage implements Stage {
  readonly name = 'post-process';

  async execute(ctx: PipelineContext): Promise<StageResult> {
    // Guard: if no finish chunk arrived but we have text and no tool calls,
    // treat as 'stop' — some providers omit the finish event on short responses.
    const effectiveReason = ctx.finishReason
      ?? (ctx.toolCalls.length > 0 ? 'tool_calls' : 'stop');

    if (ctx.finishReason === null) {
      log.warn('No finish chunk received — inferred finish reason', { effectiveReason });
    }

    // ── Helper: push assistant text message (text-only turns) ────────────
    // Note: when finishReason === 'tool_calls', ProcessToolCallsStage is
    // responsible for pushing the assistant(tool_calls) message. This helper
    // must NOT push it here — doing so creates a duplicate that causes the
    // DeepSeek API to return 400 "insufficient tool messages".
    const pushAssistantMessage = () => {
      if (!ctx.assistantText) return;
      ctx.messages.push({
        role: 'assistant',
        content: ctx.assistantText,
        ...(ctx.reasoningText ? { reasoning_content: ctx.reasoningText } : {}),
      });
    };

    // ── Stop — model finished naturally ──────────────────────────────────
    if (effectiveReason === 'stop') {
      pushAssistantMessage();
      log.debug('Turn complete — stop', { finishReason: effectiveReason });
      return { continue: false, done: true };
    }

    // ── Length — truncated by token limit; save whatever we have ─────────
    if (effectiveReason === 'length') {
      pushAssistantMessage();
      log.warn('Response truncated by token limit', {
        savedTextLength: ctx.assistantText.length,
        toolCallsDropped: ctx.toolCalls.length,
      });
      return { continue: false, done: true };
    }

    // ── Tool calls — more work needed; save text + tool_calls ────────────
    if (effectiveReason === 'tool_calls') {
      pushAssistantMessage();
      log.debug('Turn continues — tool calls pending', {
        count: ctx.toolCalls.length,
        hasText: ctx.assistantText.length > 0,
      });
      return { continue: true, done: false };
    }

    // ── Unknown — fallback; save text to avoid silent data loss ──────────
    log.warn('Unknown finish reason — saving text and stopping', {
      finishReason: effectiveReason,
      textLength: ctx.assistantText.length,
    });
    pushAssistantMessage();
    return { continue: false, done: true };
  }
}
