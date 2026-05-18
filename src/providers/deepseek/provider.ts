import type OpenAI from 'openai';
import type { LLMProvider, Message, RequestOptions, StreamChunk, ToolDefinition } from '../../types.js';
import { createOpenAIClient } from './client.js';
import type { SeekCodeConfig } from '../../types.js';
import chalk from 'chalk';

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class DeepSeekProvider implements LLMProvider {
  readonly id = 'deepseek';
  private client: OpenAI;

  constructor(config: SeekCodeConfig) {
    this.client = createOpenAIClient(config);
  }

  async *stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk> {
    const openaiMessages = messages as OpenAI.Chat.ChatCompletionMessageParam[];
    const tools = options.tools?.map(toOpenAITool);

    const stream = await this.client.chat.completions.create({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
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
        printUsage(chunk.usage);
      }

      if (!choice) continue;

      const delta = choice.delta;

      if (delta.content) {
        yield { type: 'text_delta', text: delta.content };
      }

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

function printUsage(usage: OpenAI.CompletionUsage): void {
  const cached = (usage as unknown as Record<string, unknown>)?.prompt_cache_hit_tokens as number | undefined;
  const miss   = (usage as unknown as Record<string, unknown>)?.prompt_cache_miss_tokens as number | undefined;

  if (cached === undefined) return;

  const total = usage.prompt_tokens ?? 0;
  const hitPct = total > 0 ? Math.round((cached / total) * 100) : 0;
  const hitColor = hitPct >= 50 ? chalk.green : hitPct > 0 ? chalk.yellow : chalk.gray;

  process.stderr.write(
    chalk.gray(`  tokens: prompt=${total} (`) +
    hitColor(`cache_hit=${cached} ${hitPct}%`) +
    chalk.gray(` miss=${miss ?? 0}) output=${usage.completion_tokens ?? 0}\n`),
  );
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
