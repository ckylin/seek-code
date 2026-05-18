import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { SeekCodeConfig } from './types.js';

const CONFIG_DIR = join(homedir(), '.seekcode');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULTS: SeekCodeConfig = {
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  maxTokens: 8192,
  temperature: 0.2,
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
  reasoningEffort: 'medium',
};

async function loadConfigFile(): Promise<Partial<SeekCodeConfig>> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as Partial<SeekCodeConfig>;
  } catch {
    return {};
  }
}

export async function loadConfig(): Promise<SeekCodeConfig> {
  const fileConfig = await loadConfigFile();

  return {
    provider: process.env.SEEKCODE_PROVIDER ?? fileConfig.provider ?? DEFAULTS.provider,
    model: process.env.SEEKCODE_MODEL ?? fileConfig.model ?? DEFAULTS.model,
    maxTokens: process.env.SEEKCODE_MAX_TOKENS
      ? parseInt(process.env.SEEKCODE_MAX_TOKENS, 10)
      : (fileConfig.maxTokens ?? DEFAULTS.maxTokens),
    temperature: process.env.SEEKCODE_TEMPERATURE
      ? parseFloat(process.env.SEEKCODE_TEMPERATURE)
      : (fileConfig.temperature ?? DEFAULTS.temperature),
    apiKey: process.env.DEEPSEEK_API_KEY ?? fileConfig.apiKey ?? '',
    baseURL: process.env.SEEKCODE_BASE_URL ?? fileConfig.baseURL ?? DEFAULTS.baseURL,
    reasoningEffort: (process.env.SEEKCODE_REASONING_EFFORT as 'low' | 'medium' | 'high')
      ?? fileConfig.reasoningEffort
      ?? DEFAULTS.reasoningEffort,
    topP: process.env.SEEKCODE_TOP_P
      ? parseFloat(process.env.SEEKCODE_TOP_P)
      : (fileConfig.topP ?? DEFAULTS.topP),
    frequencyPenalty: process.env.SEEKCODE_FREQUENCY_PENALTY
      ? parseFloat(process.env.SEEKCODE_FREQUENCY_PENALTY)
      : (fileConfig.frequencyPenalty ?? DEFAULTS.frequencyPenalty),
    presencePenalty: process.env.SEEKCODE_PRESENCE_PENALTY
      ? parseFloat(process.env.SEEKCODE_PRESENCE_PENALTY)
      : (fileConfig.presencePenalty ?? DEFAULTS.presencePenalty),
  };
}

export async function saveConfig(config: SeekCodeConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(
    CONFIG_PATH,
    JSON.stringify(
      {
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        reasoningEffort: config.reasoningEffort,
        topP: config.topP,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
      },
      null,
      2,
    ),
    'utf-8',
  );
}

/**
 * Detect whether the current model is a DeepSeek reasoner (R1) model.
 * R1 models do NOT support `temperature` and have different system-prompt semantics.
 */
export function isReasonerModel(model: string): boolean {
  return model.includes('reasoner') || model.toLowerCase().includes('r1');
}

/** Reasoner models have a huge context (1M tokens) — give them more room */
export const CONTEXT_BUDGET = 100_000;

/** Chat model context window is 128K — budget for conversation history */
export const CHAT_CONTEXT_BUDGET = 90_000;
