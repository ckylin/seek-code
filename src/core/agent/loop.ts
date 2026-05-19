import type {
  AgentRunOptions,
  Message,
  ToolCall,
  ToolCallMessage,
} from '../../types.js';
import chalk from 'chalk';
import ora from 'ora';
import { ContextManager } from '../context/manager.js';
import { loadProjectGuide } from '../context/project-guide.js';
import { getToolDefinitions } from '../tools/registry.js';
import { executeTool, resetYesAll } from '../tools/executor.js';
import { printToolCall, printToolResult, printAssistantHeader, printThinkingCollapsed } from '../../utils/display.js';
import { MarkdownRenderer } from '../../utils/markdown.js';
import { isReasonerModel, CHAT_CONTEXT_BUDGET } from '../../config.js';

const MAX_ITERATIONS = 30;

// ── Cumulative usage tracking ──────────────────────────────────────────────
const sessionUsage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
export function addUsage(u: { inputTokens: number; outputTokens: number; cacheHitTokens: number; cacheMissTokens: number }): void {
  sessionUsage.inputTokens += u.inputTokens;
  sessionUsage.outputTokens += u.outputTokens;
  sessionUsage.cacheHitTokens += u.cacheHitTokens;
  sessionUsage.cacheMissTokens += u.cacheMissTokens;
}
export function getSessionUsage(): typeof sessionUsage {
  return { ...sessionUsage };
}
export function resetSessionUsage(): void {
  sessionUsage.inputTokens = 0;
  sessionUsage.outputTokens = 0;
  sessionUsage.cacheHitTokens = 0;
  sessionUsage.cacheMissTokens = 0;
}

// Detect the system language from environment variables / locale.
// Returns 'zh' for Chinese systems, otherwise 'en'.
function detectSystemLanguage(): 'zh' | 'en' {
  const locale = process.env.LC_ALL
    || process.env.LC_MESSAGES
    || process.env.LANG
    || '';
  if (locale.toLowerCase().startsWith('zh')) return 'zh';
  // Also check Windows system locale
  if (process.platform === 'win32') {
    try {
      const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
      if (resolved.toLowerCase().startsWith('zh')) return 'zh';
    } catch { /* ignore */ }
  }
  return 'en';
}

// System prompt is kept stable (no dynamic content) to maximise prompt cache hits.
// For reasoner (R1) models: system prompt is injected into the first user message
// because R1 API converts system messages internally anyway.
// DeepSeek-optimized: explicit tool-calling patterns, structured thinking, and
// clear formatting rules that work well with DeepSeek's instruction-following style.
function buildSystemPrompt(guide: string | null, language: 'zh' | 'en'): string {
  const langInstruction = language === 'zh'
    ? `## Language
- The user's system language is Chinese (zh). You MUST respond in Chinese (Simplified Chinese, 简体中文) at all times.
- All explanations, summaries, and conversation with the user should be in Chinese.
- Code and technical identifiers (variable names, file paths, commands) remain in their original language.`
    : `## Language
- Respond in English only.`;

  const base = `You are Seek Code, an expert AI coding assistant running in the terminal. You are powered by DeepSeek, optimized for software engineering tasks.

You have access to tools that let you read files, write files, edit files, run shell commands, list directories, and search code. Use them to complete the user's task.

${langInstruction}

## Core Guidelines
- Read files before editing them to understand the current content
- Prefer edit_file over write_file for modifying existing files
- Run tests after making changes to verify correctness
- When a task is complete, summarize what you did concisely

## Tool Usage Best Practices
- Chain tool calls when possible: read search results, then read relevant files, then make edits
- For search_files: use specific, unique patterns to narrow results
- For execute_shell: combine commands with && when possible; avoid interactive commands
- For edit_file: old_string must match exactly including whitespace — copy from read_file output
- For list_directory: start shallow (depth 1-2) then drill deeper as needed
- Large tool outputs are truncated — use search or targeted reads when outputs are cut off

## Code Quality
- Follow existing code conventions in the project
- Write idiomatic code for the language/framework being used
- Add minimal, targeted comments for non-obvious logic only
- Handle errors gracefully in production code`;

  return guide ? base + guide : base;
}

function buildFirstUserPrefix(cwd: string, model: string, systemPrompt?: string): string {
  const parts: string[] = [];
  parts.push(`[cwd: ${cwd}]`);

  // For reasoner models: embed system prompt in the first user message
  if (isReasonerModel(model) && systemPrompt) {
    parts.push(`\n[System Instructions]\n${systemPrompt}`);
  }

  return parts.join('\n') + '\n\n';
}

export async function runAgentLoop(options: AgentRunOptions): Promise<void> {
  const { task, cwd, config, provider, onText, onToolCall, onToolResult, signal } = options;
  const model = config.model;

  const context = options.context ?? new ContextManager(CHAT_CONTEXT_BUDGET);
  const toolDefs = getToolDefinitions();

  const guide = options.systemPromptOverride ? null : await loadProjectGuide(cwd);
  const lang = detectSystemLanguage();

  // When a skill provides a system prompt override, use it instead of the
  // default coding-assistant identity. This lets skills define completely
  // different roles (e.g. "You are a BaZi fortune-telling master").
  const systemPrompt = options.systemPromptOverride
    ? options.systemPromptOverride
    : (guide ? buildSystemPrompt(guide, lang) : buildSystemPrompt(null, lang));

  const isReasoner = isReasonerModel(model);

  // Only push system prompt once per session (keeps it stable for cache hits).
  // Reasoner models skip system role — prompt goes into first user message.
  if (context.getMessages().length === 0) {
    if (!isReasoner) {
      context.push({ role: 'system', content: systemPrompt });
    }
  }

  // Reset "yes for all" at the start of each new user turn
  resetYesAll();

  // Prepend cwd (and system prompt for reasoner) to the first message of each turn
  const isFirstTurn = context.getMessages().length <= (isReasoner ? 0 : 1);
  const userContent = isFirstTurn
    ? buildFirstUserPrefix(cwd, model, isReasoner ? systemPrompt : undefined) + task
    : task;

  context.push({ role: 'user', content: userContent });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) break;

    let assistantText = '';
    let reasoningText = '';
    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason: string | null = null;
    let outputTokens = 0;
    let thinkingStartTime: number | null = null;

    // Animated spinner: "⠋ Thinking… (3s · ↑ 42 tokens · iter 2/30)"
    const startTime = Date.now();
    const thinkingSpinner = ora({
      text: chalk.gray('Thinking…'),
      color: 'gray',
      stream: process.stdout,
    });

    const updateThinkingText = (): void => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const iterInfo = iteration > 0 ? ` · iter ${iteration + 1}/${MAX_ITERATIONS}` : '';
      thinkingSpinner.text = chalk.gray(`Thinking… (${elapsed}s · ↑ ${outputTokens} tokens${iterInfo}  Esc to cancel)`);
    };

    const showThinking = (): void => {
      if (!thinkingSpinner.isSpinning) {
        thinkingSpinner.start();
        updateThinkingText();
        // Tick every second so the elapsed time updates even between chunks
        const ticker = setInterval(() => {
          if (thinkingSpinner.isSpinning) updateThinkingText();
          else clearInterval(ticker);
        }, 1000);
      } else {
        updateThinkingText();
      }
    };

    const hideThinking = (): void => {
      if (thinkingSpinner.isSpinning) {
        thinkingSpinner.stop();
      }
    };

    const stream = provider.stream(context.getMessages(), {
      model: config.model,
      maxTokens: config.maxTokens,
      // Reasoner models do not support temperature — omit it
      temperature: isReasoner ? undefined : config.temperature,
      reasoningEffort: isReasoner ? config.reasoningEffort : undefined,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      tools: toolDefs,
      signal,
    });

    const md = new MarkdownRenderer();

    // Start spinner immediately so user sees instant feedback while waiting
    // for the first streaming chunk (important for reasoner models which may
    // take 30-60 seconds to emit their first reasoning delta).
    showThinking();

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) break;

        if (chunk.type === 'text_delta') {
          hideThinking();
          if (!assistantText) {
            // Print assistant header before first text chunk
            printAssistantHeader();
          }
          assistantText += chunk.text;
          outputTokens += Math.ceil(chunk.text.length / 4);
          onText?.(chunk.text);
          const formatted = md.feed(chunk.text);
          if (formatted) process.stdout.write(formatted);
        } else if (chunk.type === 'reasoning_delta') {
          if (thinkingStartTime === null) thinkingStartTime = Date.now();
          reasoningText += chunk.text;
          outputTokens += Math.ceil(chunk.text.length / 4);
          showThinking();
        } else if (chunk.type === 'tool_call_delta') {
          const existing = toolCallAccumulator.get(chunk.index) ?? { id: '', name: '', arguments: '' };
          if (chunk.id) existing.id = chunk.id;
          if (chunk.name) existing.name = chunk.name;
          existing.arguments += chunk.arguments_delta;
          toolCallAccumulator.set(chunk.index, existing);
        } else if (chunk.type === 'finish') {
          hideThinking();
          finishReason = chunk.finish_reason;
        }
      }

      if (signal?.aborted) break;
    } finally {
      // Always stop the spinner, even on abort/error.
      // Without this, the ora timer keeps writing to stdout and corrupts
      // subsequent terminal output (e.g. the next readMultilineInput panel).
      hideThinking();
    }

    // Flush any remaining markdown buffer
    const flushOut = md.flush();
    if (flushOut) process.stdout.write(flushOut);

    // Show collapsed reasoning block after stream completes
    if (reasoningText && thinkingStartTime !== null) {
      const elapsed = Date.now() - thinkingStartTime;
      printThinkingCollapsed(reasoningText, elapsed);
    }

    // Warn if response was truncated due to token limit (especially common with
    // reasoner models whose chain-of-thought consumes most of maxTokens budget).
    if (finishReason === 'length') {
      process.stdout.write('\n');
      if (lang === 'zh') {
        process.stdout.write(chalk.yellow('⚠ 响应被截断（已达 token 上限）。请用 /config maxtokens <数值> 调高上限后重试（建议 32768 或更高）。\n'));
      } else {
        process.stdout.write(chalk.yellow('⚠ Response truncated (token limit reached). Increase with /config maxtokens <value> (try 32768 or higher).\n'));
      }
    }

    if (finishReason === 'stop' || (finishReason === 'length' && toolCallAccumulator.size === 0)) {
      if (assistantText) {
        context.push({
          role: 'assistant',
          content: assistantText,
          ...(reasoningText ? { reasoning_content: reasoningText } : {}),
        });
        process.stdout.write('\n');
      }
      break;
    }

    if (finishReason === 'tool_calls') {
      if (assistantText) process.stdout.write('\n');

      const toolCalls: ToolCall[] = Array.from(toolCallAccumulator.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));

      context.push({
        role: 'assistant',
        content: null,
        tool_calls: toolCalls,
        ...(reasoningText ? { reasoning_content: reasoningText } : {}),
      } as ToolCallMessage);

      for (const tc of toolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // leave empty
        }

        onToolCall?.(tc.function.name, parsedArgs);
        printToolCall(tc.function.name, parsedArgs);

        const toolSpinner = ora({
          text: chalk.gray(`Running ${tc.function.name}…`),
          color: 'cyan',
          stream: process.stdout,
        }).start();

        // Stop spinner before executing so confirmation UIs (edit_file, write_file)
        // can take over stdout/raw-mode without the spinner corrupting their output.
        toolSpinner.stop();

        const result = await executeTool(tc.function.name, tc.function.arguments, cwd);

        onToolResult?.(tc.function.name, result);
        printToolResult(tc.function.name, result);

        context.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.success ? result.output : (result.error ?? result.output),
        });

        if (result.userRejected) {
          return;
        }
      }

      // continue loop — model will process tool results
    } else {
      // length or unknown finish reason — stop
      if (assistantText) process.stdout.write('\n');
      break;
    }
  }
}
