import type OpenAI from 'openai';
import type { LLMProvider, Message, RequestOptions, StreamChunk, ToolDefinition, TextMessage, ToolCallMessage } from '../../types.js';
import { createOpenAIClient } from './client.js';
import type { CodeGruntConfig } from '../../types.js';
import chalk from 'chalk';
import { addUsage } from '../../core/agent/loop.js';
import { recordUsage } from '../../utils/billing.js';

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class DeepSeekProvider implements LLMProvider {
  readonly id = 'deepseek';
  private client: OpenAI;

  constructor(config: CodeGruntConfig) {
    this.client = createOpenAIClient(config);
  }

  async *stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk> {
    // Convert our Message[] to OpenAI format, preserving reasoning_content
    const openaiMessages = messages.map(toOpenAIMessage);
    const tools = options.tools?.map(toOpenAITool);

    const stream = await this.client.chat.completions.create({
      model: options.model,
      max_tokens: options.maxTokens,
      // temperature is intentionally undefined for reasoner models
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      // DeepSeek-specific parameters
      ...(options.topP !== undefined ? { top_p: options.topP } : {}),
      ...(options.frequencyPenalty !== undefined ? { frequency_penalty: options.frequencyPenalty } : {}),
      ...(options.presencePenalty !== undefined ? { presence_penalty: options.presencePenalty } : {}),
      // R1 reasoning effort: controls how long the model thinks
      ...(options.reasoningEffort !== undefined
        ? { reasoning_effort: options.reasoningEffort } as Record<string, unknown>
        : {}),
      messages: openaiMessages,
      tools: tools && tools.length > 0 ? tools : undefined,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      stream: true,
      stream_options: { include_usage: true },
    }, { signal: options.signal });

    const accumulator = new Map<number, AccumulatedToolCall>();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      // Usage stats arrive in the final chunk (choices may be empty)
      if (chunk.usage) {
        printUsage(chunk.usage, options.model);
      }

      if (!choice) continue;

      const delta = choice.delta;

      if (delta.content) {
        yield { type: 'text_delta', text: delta.content };
      }

      // DeepSeek reasoning_content — chain of thought (V4 & R1 both emit this)
      const reasoning = (delta as unknown as Record<string, unknown>).reasoning_content as string | undefined;
      if (reasoning) {
        yield { type: 'reasoning_delta', text: reasoning };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = accumulator.get(tc.index) ?? { id: '', name: '', arguments: '' };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          accumulator.set(tc.index, existing);

          yield {
            type: 'tool_call_delta',
            index: tc.index,
            id: tc.id,
            name: tc.function?.name,
            arguments_delta: tc.function?.arguments ?? '',
          };
        }
      }

      if (choice.finish_reason) {
        yield {
          type: 'finish',
          finish_reason: choice.finish_reason as 'stop' | 'tool_calls' | 'length',
        };
      }
    }
  }
}

/** Serialize our internal Message to OpenAI-compatible format, preserving reasoning_content */
function toOpenAIMessage(msg: Message): OpenAI.Chat.ChatCompletionMessageParam {
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: msg.tool_call_id,
      content: msg.content,
    };
  }

  if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
    const tcMsg = msg as ToolCallMessage;
    return {
      role: 'assistant',
      content: null,
      tool_calls: tcMsg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
      // Preserve reasoning_content so the model sees its own chain of thought
      ...(tcMsg.reasoning_content ? { reasoning_content: tcMsg.reasoning_content } as Record<string, unknown> : {}),
    } as unknown as OpenAI.Chat.ChatCompletionMessageParam;
  }

  // Regular text message (system / user / assistant with content)
  const textMsg = msg as TextMessage;
  return {
    role: textMsg.role as 'system' | 'user' | 'assistant',
    content: textMsg.content,
    // Preserve reasoning_content in assistant messages for multi-turn continuity
    ...(textMsg.role === 'assistant' && textMsg.reasoning_content
      ? { reasoning_content: textMsg.reasoning_content } as Record<string, unknown>
      : {}),
  } as OpenAI.Chat.ChatCompletionMessageParam;
}

// ── DeepSeek pricing (USD per 1M tokens) ────────────────────────────────────
const PRICING = {
  chat:    { prompt: 0.27, completion: 1.10, cacheHit: 0.07 },
  reasoner:{ prompt: 0.55, completion: 2.19, cacheHit: 0.14 },
} as const;

function detectModelType(model: string): 'chat' | 'reasoner' {
  return model.includes('reasoner') || model.toLowerCase().includes('r1') ? 'reasoner' : 'chat';
}

function printUsage(usage: OpenAI.CompletionUsage, model: string): void {
  const cached = (usage as unknown as Record<string, unknown>)?.prompt_cache_hit_tokens as number | undefined;
  const miss   = (usage as unknown as Record<string, unknown>)?.prompt_cache_miss_tokens as number | undefined;
  const modelType = detectModelType(model);
  const p = modelType === 'reasoner' ? PRICING.reasoner : PRICING.chat;

  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const cacheHits = cached ?? 0;

  if (cached !== undefined && (process.env['DEBUG'] || process.env['CODEGRUNT_VERBOSE'])) {
    const total = inputTokens;
    const hitPct = total > 0 ? Math.round((cached / total) * 100) : 0;
    const hitColor = hitPct >= 50 ? chalk.green : hitPct > 0 ? chalk.yellow : chalk.gray;

    process.stderr.write(
      chalk.gray(`  tokens: prompt=${total} (`) +
      hitColor(`cache_hit=${cached} ${hitPct}%`) +
      chalk.gray(` miss=${miss ?? 0}) output=${outputTokens}\n`),
    );
  }

  // Session tracking (in-memory)
  addUsage({
    inputTokens,
    outputTokens,
    cacheHitTokens: cacheHits,
    cacheMissTokens: miss ?? 0,
  });

  // Persist to local usage log (fire-and-forget — don't block the stream)
  const inputCost = (inputTokens / 1_000_000) * p.prompt;
  const outputCost = (outputTokens / 1_000_000) * p.completion;
  const cacheSavings = (cacheHits / 1_000_000) * (p.prompt - p.cacheHit);
  const totalCost = inputCost + outputCost - cacheSavings;
  recordUsage(inputTokens, outputTokens, cacheHits, totalCost).catch(() => {});
}

function toOpenAITool(def: ToolDefinition): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: def.function.name,
      description: def.function.description,
      parameters: def.function.parameters as OpenAI.FunctionParameters,
    },
  };
}
