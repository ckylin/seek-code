#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../config.js';
import { DeepSeekProvider } from '../providers/deepseek/provider.js';
import { startRepl } from './repl.js';
import { runAgentLoop } from '../core/agent/loop.js';
import { createInterruptController } from '../utils/interrupt.js';
import { printError } from '../utils/display.js';
import { runSetup } from './setup.js';

const program = new Command();

program
  .name('seekcode')
  .description('AI-powered CLI coding assistant')
  .version('0.1.0')
  .argument('[task]', 'One-shot task to execute (omit for interactive mode)')
  .option('-m, --model <model>', 'Model to use')
  .option('--max-tokens <n>', 'Max tokens per response', parseInt)
  .action(async (task: string | undefined, opts: { model?: string; maxTokens?: number }) => {
    let config = await loadConfig();

    if (opts.model) config.model = opts.model;
    if (opts.maxTokens) config.maxTokens = opts.maxTokens;

    if (!config.apiKey) {
      config = await runSetup(config);
    }

    const provider = new DeepSeekProvider(config);

    if (task) {
      // One-shot mode
      const interrupt = createInterruptController();
      try {
        await runAgentLoop({
          task,
          cwd: process.cwd(),
          config,
          provider,
          signal: interrupt.signal,
        });
        process.stdout.write('\n');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError' || interrupt.signal.aborted) {
          process.stdout.write(chalk.yellow('\nInterrupted.\n'));
        } else {
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      } finally {
        interrupt.cleanup();
      }
    } else {
      // Interactive REPL mode
      await startRepl(config, provider);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  printError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
