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
  };
}

export async function saveConfig(config: SeekCodeConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(
    CONFIG_PATH,
    JSON.stringify(
      { apiKey: config.apiKey, model: config.model, maxTokens: config.maxTokens, temperature: config.temperature },
      null,
      2,
    ),
    'utf-8',
  );
}
