import type { Message } from '../../types.js';

const CHARS_PER_TOKEN = 4;

export class ContextManager {
  private messages: Message[] = [];
  private readonly tokenBudget: number;

  constructor(tokenBudget = 60_000) {
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

  estimatedTokenCount(): number {
    return this.estimateTokens();
  }

  private estimateTokens(): number {
    return this.messages.reduce((sum, msg) => {
      const content = 'content' in msg && msg.content ? String(msg.content) : '';
      return sum + Math.ceil(content.length / CHARS_PER_TOKEN);
    }, 0);
  }

  private trim(): void {
    const hasSystem = this.messages[0]?.role === 'system';
    while (this.estimateTokens() > this.tokenBudget && this.messages.length > 2) {
      // Remove the oldest non-system message (index 1 if system exists, else index 0)
      this.messages.splice(hasSystem ? 1 : 0, 1);
    }
  }
}
