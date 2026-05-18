import type { Message } from '../../types.js';

const CHARS_PER_TOKEN = 4;

export class ContextManager {
  private messages: Message[] = [];
  private tokenBudget: number;

  /**
   * @param tokenBudget Maximum estimated tokens for stored messages.
   *                    For DeepSeek-V4 (128K context), default ~90K leaves room for output.
   *                    For R1 reasoner (1M context), can go much higher.
   */
  constructor(tokenBudget = 90_000) {
    this.tokenBudget = tokenBudget;
  }

  push(message: Message): void {
    this.messages.push(message);
    this.trim();
  }

  getMessages(): Message[] {
    return this.messages;
  }

  clear(): void {
    this.messages = [];
  }

  /** Replace messages wholesale (used for cache-warm restart) */
  setMessages(msgs: Message[]): void {
    this.messages = msgs;
    this.trim();
  }

  estimatedTokenCount(): number {
    return this.estimateTokens();
  }

  /** Adjust the token budget dynamically (e.g. when switching models) */
  setTokenBudget(budget: number): void {
    this.tokenBudget = budget;
    this.trim();
  }

  private estimateTokens(): number {
    let total = 0;
    for (const msg of this.messages) {
      if ('content' in msg && msg.content) {
        total += Math.ceil(String(msg.content).length / CHARS_PER_TOKEN);
      }
      // Account for reasoning_content in token count
      if ('reasoning_content' in msg && msg.reasoning_content) {
        total += Math.ceil(String(msg.reasoning_content).length / CHARS_PER_TOKEN);
      }
      // Tool calls consume tokens
      if ('tool_calls' in msg && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          total += Math.ceil(tc.function.name.length / CHARS_PER_TOKEN);
          total += Math.ceil(tc.function.arguments.length / CHARS_PER_TOKEN);
        }
      }
    }
    return total;
  }

  private trim(): void {
    const hasSystem = this.messages[0]?.role === 'system';
    const startIdx = hasSystem ? 1 : 0;
    // Keep system + at least the last 4 messages (user/assistant/tool pairs)
    const minMessages = hasSystem ? 5 : 4;
    while (this.estimateTokens() > this.tokenBudget && this.messages.length > minMessages) {
      this.removeOldestGroup(startIdx);
    }
  }

  /**
   * Remove the oldest message group from the conversation, preserving
   * assistant(tool_calls) ↔ tool message pairing required by the LLM API.
   */
  private removeOldestGroup(startIdx: number): void {
    const msg = this.messages[startIdx];

    if (msg && msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
      // This is an assistant message with tool calls — must remove it
      // together with all subsequent tool response messages.
      let removeCount = 1;
      while (
        startIdx + removeCount < this.messages.length &&
        this.messages[startIdx + removeCount].role === 'tool'
      ) {
        removeCount++;
      }
      this.messages.splice(startIdx, removeCount);
    } else if (msg && msg.role === 'tool') {
      // Standalone tool message without preceding assistant(tool_calls) —
      // this can happen if the assistant was already removed. Skip it
      // to avoid breaking the stream, and also skip any contiguous tool messages.
      let removeCount = 1;
      while (
        startIdx + removeCount < this.messages.length &&
        this.messages[startIdx + removeCount].role === 'tool'
      ) {
        removeCount++;
      }
      this.messages.splice(startIdx, removeCount);
    } else {
      // Plain message (user, assistant without tool_calls, system) — safe to remove
      this.messages.splice(startIdx, 1);
    }
  }
}
