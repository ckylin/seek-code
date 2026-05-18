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
import { printToolCall, printToolResult } from '../../utils/display.js';

const MAX_ITERATIONS = 30;

// System prompt is kept stable (no dynamic content) to maximise prompt cache hits.
// The current date and cwd are injected into the first user message instead.
function buildSystemPrompt(guide: string | null): string {
  const base = `You are Seek Code, an expert AI coding assistant running in the terminal.

You have access to tools that let you read files, write files, edit files, run shell commands, list directories, and search code. Use them to complete the user's task.

Guidelines:
- Read files before editing them to understand the current content
- Prefer edit_file over write_file for modifying existing files
- Run tests after making changes to verify correctness
- When a task is complete, summarize what you did concisely`;

  return guide ? base + guide : base;
}

function buildFirstUserPrefix(cwd: string): string {
  return `[cwd: ${cwd}  date: ${new Date().toISOString().split('T')[0]}]\n\n`;
}

export async function runAgentLoop(options: AgentRunOptions): Promise<void> {
  const { task, cwd, config, provider, onText, onToolCall, onToolResult, signal } = options;

  const context = options.context ?? new ContextManager(Math.floor(config.maxTokens * 7));
  const toolDefs = getToolDefinitions();

  // Only push system prompt once per session (keeps it stable for cache hits)
  if (context.getMessages().length === 0) {
    const guide = await loadProjectGuide(cwd);
    context.push({ role: 'system', content: buildSystemPrompt(guide) });
  }

  // Reset "yes for all" at the start of each new user turn
  resetYesAll();

  // Prepend cwd + date to the first message of each turn (not the system prompt)
  const isFirstTurn = context.getMessages().length === 1;
  const userContent = isFirstTurn
    ? buildFirstUserPrefix(cwd) + task
    : task;

  context.push({ role: 'user', content: userContent });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) break;

    let assistantText = '';
    let reasoningText = '';
    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason: string | null = null;
    let outputTokens = 0;

    // Animated spinner: "⠋ Thinking… (3s · ↑ 42 tokens)"
    const startTime = Date.now();
    const thinkingSpinner = ora({
      text: chalk.gray('Thinking…'),
      color: 'gray',
      stream: process.stdout,
    });

    const updateThinkingText = (): void => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      thinkingSpinner.text = chalk.gray(`Thinking… (${elapsed}s · ↑ ${outputTokens} tokens)`);
    };

    const showThinking = (): void => {
      if (!thinkingSpinner.isSpinning) {
        thinkingSpinner.start();
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
      if (thinkingSpinner.isSpinning) thinkingSpinner.stop();
    };

    const stream = provider.stream(context.getMessages(), {
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      tools: toolDefs,
      signal,
    });

    for await (const chunk of stream) {
      if (signal?.aborted) break;

      if (chunk.type === 'text_delta') {
        hideThinking();
        assistantText += chunk.text;
        outputTokens += Math.ceil(chunk.text.length / 4);
        onText?.(chunk.text);
        process.stdout.write(chunk.text);
      } else if (chunk.type === 'reasoning_delta') {
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

    if (finishReason === 'stop' || toolCallAccumulator.size === 0) {
      if (assistantText) {
        const msg = { role: 'assistant' as const, content: assistantText, ...(reasoningText ? { reasoning_content: reasoningText } : {}) };
        context.push(msg as import('../../types.js').TextMessage);
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

      const assistantMsg: ToolCallMessage & { reasoning_content?: string } = {
        role: 'assistant',
        content: null,
        tool_calls: toolCalls,
      };
      if (reasoningText) assistantMsg.reasoning_content = reasoningText;
      context.push(assistantMsg as ToolCallMessage);

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

        const result = await executeTool(tc.function.name, tc.function.arguments, cwd);
        toolSpinner.stop();

        onToolResult?.(tc.function.name, result);
        printToolResult(tc.function.name, result);

        context.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.success ? result.output : (result.error ?? result.output),
        });
      }

      // continue loop — model will process tool results
    } else {
      // length or unknown finish reason — stop
      if (assistantText) process.stdout.write('\n');
      break;
    }
  }
}
