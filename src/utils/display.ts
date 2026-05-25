import chalk from 'chalk';
import { createPatch } from 'diff';
import type { ToolResult } from '../types.js';
import type { TaskPlan, EvaluationResult, IntentResult } from '../core/pipeline/types.js';
import { ACCENT } from './constants.js';

const blue  = (s: string) => chalk.hex(ACCENT)(s);
const muted = chalk.gray;
const success = chalk.green;
const danger  = chalk.red;
const warning = chalk.yellow;

export function printToolCall(name: string, args: Record<string, unknown>): void {
  // Show only the most identifying argument (path, command, pattern, query)
  const KEY_PRIORITY = ['path', 'command', 'pattern', 'query', 'file_path'];
  const key = KEY_PRIORITY.find(k => k in args) ?? Object.keys(args)[0];
  const val = key
    ? (typeof args[key] === 'string' && (args[key] as string).length > 60
        ? (args[key] as string).slice(0, 60) + '…'
        : String(args[key]))
    : '';
  process.stdout.write('  ' + muted(name) + (val ? '  ' + chalk.white(val) : '') + '\n');
}

export function printToolResult(name: string, result: ToolResult): void {
  if (!result.success) {
    const msg = (result.error ?? result.output).slice(0, 100);
    process.stdout.write('  ' + danger('✗') + '  ' + danger(msg) + '\n');
  }
  // Success is silent — tool name already shown by printToolCall
}

export function printUserMessage(text: string): void {
  process.stdout.write('\n  ' + blue('You') + '\n');
  for (const line of text.split('\n')) {
    process.stdout.write('  ' + chalk.white(line) + '\n');
  }
  process.stdout.write('\n');
}

export function printAssistantHeader(): void {
  const cols = process.stdout.columns || 80;
  const label = ' ' + blue('CodeGrunt') + ' ';
  const labelLen = ' CodeGrunt '.length;
  const fill = Math.max(0, cols - labelLen - 2);
  const half = Math.floor(fill / 2);
  process.stdout.write(
    '\n' + muted('-'.repeat(half)) + label + muted('-'.repeat(fill - half)) + '\n\n'
  );
}

export function printThinkingCollapsed(reasoningText: string, elapsedMs: number): void {
  const secs = Math.round(elapsedMs / 1000);
  process.stdout.write(muted(`  thought for ${secs}s\n\n`));
}

export function printDiff(filePath: string, oldContent: string, newContent: string): void {
  const patch = createPatch(filePath, oldContent, newContent, '', '', { context: 3 });
  const lines = patch.split('\n');
  const out: string[] = [];
  for (const line of lines.slice(2)) {
    if (line.startsWith('@@')) {
      out.push(blue(line));
    } else if (line.startsWith('+')) {
      out.push(success(line));
    } else if (line.startsWith('-')) {
      out.push(danger(line));
    } else {
      out.push(muted(line));
    }
  }
  process.stdout.write(out.join('\n') + '\n');
}

export function printError(message: string): void {
  process.stderr.write(danger('  error  ') + message + '\n');
}

export function printInfo(message: string): void {
  process.stdout.write(muted('  ' + message) + '\n');
}

export function printDivider(): void {
  process.stdout.write(muted('-'.repeat(process.stdout.columns || 80)) + '\n');
}

// ── P/G/E Plan & Evaluation Display ─────────────────────────────────────

/** Display intent classification result — only shown for non-coding path */
export function printIntentResult(intent: IntentResult): void {
  if (!intent.isCoding) {
    process.stdout.write(muted('  chat mode\n'));
  }
}

/** Display the plan header when Planner completes */
export function printPlanHeader(plan: TaskPlan): void {
  const stepCount = plan.steps.length;
  process.stdout.write('\n  ' + blue('▸') + '  ' + chalk.bold(plan.goal) + muted(`  (${stepCount} steps)`) + '\n');
}

/** Display current step progress */
export function printStepProgress(stepIndex: number, totalSteps: number, description: string): void {
  const truncated = description.length > 60 ? description.slice(0, 60) + '…' : description;
  process.stdout.write('\n' + muted(`  ${stepIndex + 1}/${totalSteps}  `) + truncated + '\n');
}

/** Display evaluation result — silent on PASS, shows issues on FAIL */
export function printEvaluation(evaluation: EvaluationResult, _language: 'zh' | 'en'): void {
  if (evaluation.passed) return;
  const scoreColor = evaluation.score >= 60 ? warning : danger;
  process.stdout.write('  ' + danger('✗') + '  ' + scoreColor(`${evaluation.score}/100`) + '\n');
  for (const issue of evaluation.issues.slice(0, 2)) {
    process.stdout.write('  ' + muted('  ') + danger(String(issue).slice(0, 100)) + '\n');
  }
}

/** Display refinement retry indicator */
export function printRefineIndicator(retryCount: number, maxRetries: number, _language: 'zh' | 'en'): void {
  process.stdout.write(muted(`  retrying ${retryCount}/${maxRetries}…\n`));
}
