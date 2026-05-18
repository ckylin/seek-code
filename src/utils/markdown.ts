import chalk from 'chalk';

/**
 * Streaming Markdown renderer for terminal output.
 *
 * Buffers text by line and renders each line with terminal formatting.
 * Supports: **bold**, *italic*, `inline code`, ```code blocks```,
 * # headers, - lists, > blockquotes, --- dividers, __underline__.
 *
 * For streaming, incomplete lines are buffered until newline or flush.
 * Code blocks are detected via ``` fences and rendered in a framed box.
 */

type MdState =
  | { kind: 'text' }
  | { kind: 'code_block'; buf: string };

export class MarkdownRenderer {
  private state: MdState = { kind: 'text' };
  private lineBuf = '';
  private codeBlockLang = '';
  private fenceCount = 0;

  /** Feed a text chunk and get rendered output back. */
  feed(chunk: string): string {
    let out = '';

    for (const ch of chunk) {
      if (ch === '\n') {
        out += this.commitLine();
      } else {
        this.lineBuf += ch;
      }
    }

    return out;
  }

  /** Flush any remaining buffered content. Call at end of stream. */
  flush(): string {
    // Commit whatever's left in the line buffer
    return this.commitLine();
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private commitLine(): string {
    const raw = this.lineBuf;
    this.lineBuf = '';

    if (this.state.kind === 'text') {
      // Detect ``` fence start
      const fenceMatch = raw.match(/^```(\S*)$/);
      if (fenceMatch) {
        this.state = { kind: 'code_block', buf: '' };
        this.codeBlockLang = fenceMatch[1] || '';
        this.fenceCount = 0;
        return ''; // opening fence is silent
      }

      return this.renderLine(raw) + '\n';
    }

    // Inside code block
    const s = this.state as { kind: 'code_block'; buf: string };

    // Detect closing ``` fence
    if (/^```\s*$/.test(raw)) {
      this.fenceCount++;
      if (this.fenceCount >= 1) {
        const out = this.formatCodeBlock(s.buf);
        this.state = { kind: 'text' };
        this.codeBlockLang = '';
        this.fenceCount = 0;
        return out + '\n';
      }
    }

    // Accumulate code block content
    if (s.buf) s.buf += '\n';
    s.buf += raw;
    return '';
  }

  // ── Line-level rendering ───────────────────────────────────────────────

  private renderLine(line: string): string {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) return '';

    // ### Headers
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = this.renderInline(headerMatch[2]);
      if (level === 1) return chalk.bold.underline(text);
      if (level === 2) return chalk.bold(text);
      return chalk.bold.dim(text);
    }

    // --- horizontal rule
    if (/^-{3,}$/.test(trimmed)) {
      return chalk.gray('─'.repeat(Math.min(process.stdout.columns || 80, 80)));
    }

    // > blockquote
    if (trimmed.startsWith('> ')) {
      const content = this.renderInline(trimmed.slice(2));
      return chalk.gray('│ ') + chalk.italic(content);
    }

    // - unordered list / * list
    if (/^[-*]\s+/.test(trimmed)) {
      const indent = trimmed.match(/^(\s*)/)?.[1] ?? '';
      const content = trimmed.replace(/^(\s*)[-*]\s+/, '');
      return indent + chalk.cyan('• ') + this.renderInline(content);
    }

    // 1. ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const match = trimmed.match(/^(\s*)(\d+)\.\s+(.*)/);
      if (match) {
        return match[1] + chalk.cyan(match[2] + '. ') + this.renderInline(match[3]);
      }
    }

    return this.renderInline(trimmed);
  }

  // ── Inline formatting ──────────────────────────────────────────────────

  private renderInline(text: string): string {
    let result = text;

    // **bold** or __bold__
    result = result.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
    result = result.replace(/__(.+?)__/g, (_, t) => chalk.bold(t));

    // *italic* or _italic_
    result = result.replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t));
    result = result.replace(/_(.+?)_/g, (_, t) => chalk.italic(t));

    // `inline code`
    result = result.replace(/`([^`]+)`/g, (_, t) => chalk.cyan.bgBlack(' ' + t + ' '));

    // ~~strikethrough~~
    result = result.replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t));

    return result;
  }

  // ── Code block rendering ───────────────────────────────────────────────

  private formatCodeBlock(code: string): string {
    const lines = code.split('\n');
    const maxCols = Math.min(process.stdout.columns || 80, 100);
    const label = this.codeBlockLang ? chalk.gray(' ' + this.codeBlockLang + ' ') : '';

    let out = chalk.gray('┌' + '─'.repeat(Math.min(maxCols - 2, 40)) + label) + '\n';

    for (const codeLine of lines) {
      const trimmed = codeLine.trimEnd();
      const truncated = trimmed.length > maxCols - 2
        ? trimmed.slice(0, maxCols - 5) + '…'
        : trimmed;
      out += chalk.gray('│') + chalk.white(truncated) + '\n';
    }

    out += chalk.gray('└' + '─'.repeat(Math.min(maxCols - 2, 40)));
    return out;
  }
}
