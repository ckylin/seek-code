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
  | { kind: 'code_block'; buf: string }
  | { kind: 'table'; rows: string[] };

export class MarkdownRenderer {
  private state: MdState = { kind: 'text' };
  private lineBuf = '';
  private codeBlockLang = '';
  private fenceCount = 0;
  private pendingTableRow: string | null = null;

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
    // Flush active table
    if (this.state.kind === 'table') {
      const out = this.renderTable(this.state.rows);
      this.state = { kind: 'text' };
      if (this.lineBuf) {
        return out + '\n' + this.renderLine(this.lineBuf);
      }
      return out;
    }

    // Flush pending table row (was never followed by a separator)
    if (this.pendingTableRow !== null) {
      const pre = this.renderLine(this.pendingTableRow) + '\n';
      this.pendingTableRow = null;
      if (this.lineBuf) {
        return pre + this.renderLine(this.lineBuf);
      }
      return pre;
    }

    // Commit whatever's left in the line buffer
    if (this.lineBuf) {
      return this.renderLine(this.lineBuf);
    }
    return '';
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private commitLine(): string {
    const raw = this.lineBuf;
    this.lineBuf = '';

    // ── Code block state ───────────────────────────────────────────────
    if (this.state.kind === 'code_block') {
      const s = this.state;

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

    // ── Table state ───────────────────────────────────────────────────
    if (this.state.kind === 'table') {
      if (this.isTableRow(raw)) {
        this.state.rows.push(raw);
        return '';
      }
      // Table ended — render and fall through to process current line as text
      const out = this.renderTable(this.state.rows);
      this.state = { kind: 'text' };
      this.lineBuf = raw;
      return out + '\n' + this.commitLine();
    }

    // ── Text state ────────────────────────────────────────────────────
    // Detect ``` fence start
    const fenceMatch = raw.match(/^```(\S*)$/);
    if (fenceMatch) {
      // Flush any pending table row before starting code block
      let pre = '';
      if (this.pendingTableRow !== null) {
        pre = this.renderLine(this.pendingTableRow) + '\n';
        this.pendingTableRow = null;
      }
      this.state = { kind: 'code_block', buf: '' };
      this.codeBlockLang = fenceMatch[1] || '';
      this.fenceCount = 0;
      return pre; // opening fence is silent
    }

    // Table row detection
    if (this.isTableRow(raw)) {
      if (this.pendingTableRow !== null && this.isTableSeparator(raw)) {
        // Confirmed: pendingTableRow is header, raw is separator
        this.state = { kind: 'table', rows: [this.pendingTableRow, raw] };
        this.pendingTableRow = null;
        return '';
      }
      // Flush previous pending row (it wasn't a table header after all)
      let pre = '';
      if (this.pendingTableRow !== null) {
        pre = this.renderLine(this.pendingTableRow) + '\n';
      }
      this.pendingTableRow = raw;
      return pre;
    }

    // Not a table row — flush any pending row
    if (this.pendingTableRow !== null) {
      const pre = this.renderLine(this.pendingTableRow) + '\n';
      this.pendingTableRow = null;
      return pre + this.renderLine(raw) + '\n';
    }

    return this.renderLine(raw) + '\n';
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

  // ── Table rendering ────────────────────────────────────────────────────

  /** Check if a trimmed line looks like a markdown table row: starts and ends with | */
  private isTableRow(line: string): boolean {
    const t = line.trimEnd();
    return t.startsWith('|') && t.endsWith('|') && t.length > 2;
  }

  /** Check if a trimmed line is a table separator row: |---|:---:| etc. */
  private isTableSeparator(line: string): boolean {
    const t = line.trimEnd();
    if (!t.startsWith('|') || !t.endsWith('|')) return false;
    const cells = t.slice(1, -1).split('|');
    if (cells.length < 1) return false;
    return cells.every(c => /^:?-+:?$/.test(c.trim()));
  }

  /** Split a table row into cell contents */
  private parseTableRow(row: string): string[] {
    const trimmed = row.trimEnd();
    return trimmed.slice(1, -1).split('|').map(c => c.trim());
  }

  /** Strip ANSI escape codes to measure visual width */
  private stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /** Render a buffered table (header + separator + data rows) */
  private renderTable(rows: string[]): string {
    // rows[0] = header, rows[1] = separator, rows[2..] = data
    const headerRaw = this.parseTableRow(rows[0]);
    const dataRaw = rows.slice(2).map(r => this.parseTableRow(r));

    // Render inline formatting for all cells
    const header = headerRaw.map(c => this.renderInline(c));
    const data = dataRaw.map(row => row.map(c => this.renderInline(c)));

    // Calculate visual widths (min 3 per column)
    const colCount = header.length;
    const widths: number[] = [];
    for (let i = 0; i < colCount; i++) {
      let maxW = this.stripAnsi(header[i]).length;
      for (const row of data) {
        const w = this.stripAnsi(row[i] ?? '').length;
        if (w > maxW) maxW = w;
      }
      widths.push(Math.max(maxW, 3));
    }

    // Pad a cell to target visual width
    const pad = (s: string, w: number): string => {
      const visual = this.stripAnsi(s);
      return s + ' '.repeat(w - visual.length);
    };

    const gray = chalk.gray;
    const sep = gray(' │ ');
    let out = '';

    // Top border
    out += gray('┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐') + '\n';

    // Header row (bold)
    out += gray('│ ') + header.map((c, i) => chalk.bold(pad(c, widths[i]))).join(sep) + gray(' │') + '\n';

    // Separator
    out += gray('├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤') + '\n';

    // Data rows
    for (const row of data) {
      const cells = [];
      for (let i = 0; i < colCount; i++) {
        cells.push(pad(row[i] ?? '', widths[i]));
      }
      out += gray('│ ') + cells.join(sep) + gray(' │') + '\n';
    }

    // Bottom border
    out += gray('└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');

    return out;
  }
}
