import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { SeekCodeConfig } from './types.js';

const DEFAULTS: SeekCodeConfig = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  maxTokens: 8192,
  temperature: 0.2,
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
};

async function loadConfigFile(): Promise<Partial<SeekCodeConfig>> {
  const configPath = join(homedir(), '.seekcode', 'config.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
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
  };
}
