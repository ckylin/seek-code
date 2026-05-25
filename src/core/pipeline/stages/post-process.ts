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
    const isTextOnly = ctx.finishReason === 'stop'
      || (ctx.finishReason === 'length' && ctx.toolCalls.length === 0);

    if (isTextOnly) {
      // Push final assistant text message
      if (ctx.assistantText) {
        ctx.messages.push({
          role: 'assistant',
          content: ctx.assistantText,
          ...(ctx.reasoningText ? { reasoning_content: ctx.reasoningText } : {}),
        });
      }

      // Warn about truncation
      if (ctx.finishReason === 'length') {
        log.warn('Response truncated by token limit');
      }

      log.debug('Turn complete — stop', { finishReason: ctx.finishReason });
      return { continue: false, done: true };
    }

    if (ctx.finishReason === 'tool_calls') {
      // Continue loop — model will process tool results
      log.debug('Turn continues — tool calls pending', { count: ctx.toolCalls.length });
      return { continue: true, done: false };
    }

    // Unknown finish reason — stop gracefully
    log.warn('Unknown finish reason — stopping', { finishReason: ctx.finishReason });
    return { continue: false, done: true };
  }
}
