import * as readline from 'readline';
import { writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import type { SeekCodeConfig } from '../types.js';
import { selectFromList } from './input.js';
import { validateApiKey } from '../providers/deepseek/client.js';

const CONFIG_DIR = join(homedir(), '.seekcode');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export const DEEPSEEK_MODELS: Array<{ id: string; label: string; description: string }> = [
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    description: 'General-purpose chat model (aliased to latest)',
  },
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description: 'Fast & cheap, great for most coding tasks',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: 'Most capable, best for complex reasoning',
  },
];

export async function runSetup(existingConfig: SeekCodeConfig): Promise<SeekCodeConfig> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  console.log(chalk.bold('\nWelcome to Seek Code!'));
  console.log(chalk.gray("Let's set up your configuration.\n"));
  console.log(
    chalk.gray('Get your DeepSeek API key at: ') +
    chalk.cyan('https://platform.deepseek.com/api_keys') + '\n',
  );

  // ── API Key ──────────────────────────────────────────────────────────────
  // Wrap the readline loop in try/finally so rl.close() is always called even
  // if validateApiKey throws or the process is interrupted mid-prompt.
  let apiKey = '';
  try {
    while (true) {
      apiKey = (await ask(chalk.bold('DeepSeek API Key: '))).trim();
      if (!apiKey) {
        console.log(chalk.yellow('API key cannot be empty.'));
        continue;
      }
      process.stdout.write(chalk.gray('Validating API key…'));
      const err = await validateApiKey(apiKey, existingConfig.baseURL);
      if (err) {
        process.stdout.write('\r' + ' '.repeat(30) + '\r');
        console.log(chalk.red(`✗ ${err} Please try again.`));
      } else {
        process.stdout.write('\r' + ' '.repeat(30) + '\r');
        break;
      }
    }
  } finally {
    rl.close();
  }

  // ── Model selection — arrow-key dropdown ─────────────────────────────────
  console.log();
  const selectedModel = await selectFromList(
    'Select model',
    DEEPSEEK_MODELS.map((m) => ({ value: m.id, label: m.label, desc: m.description })),
    existingConfig.model,
  );
  const model = selectedModel ?? existingConfig.model;

  const config: SeekCodeConfig = { ...existingConfig, apiKey, model };
  const selected = DEEPSEEK_MODELS.find((m) => m.id === model);

  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(
    CONFIG_PATH,
    JSON.stringify(
      {
        apiKey,
        model,
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

  console.log(
    chalk.green(`\n✓ Config saved`) +
    chalk.gray(` — model: `) + chalk.cyan(selected?.label ?? model) +
    chalk.gray(` → ${CONFIG_PATH}\n`),
  );

  return config;
}
