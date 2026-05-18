#!/usr/bin/env node
process.title = 'Seek Code';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, isReasonerModel, CHAT_CONTEXT_BUDGET, CONTEXT_BUDGET } from '../config.js';
import { DeepSeekProvider } from '../providers/deepseek/provider.js';
import { ContextManager } from '../core/context/manager.js';
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
      const budget = isReasonerModel(config.model) ? CONTEXT_BUDGET : CHAT_CONTEXT_BUDGET;
      const context = new ContextManager(budget);
      const interrupt = createInterruptController();
      try {
        await runAgentLoop({
          task,
          cwd: process.cwd(),
          config,
          provider,
          context,
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

program
  .command('update')
  .description('Check for updates and upgrade to the latest version')
  .option('-c, --check', 'Only check for updates, do not install')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts: { check?: boolean; yes?: boolean }) => {
    const { runUpdate } = await import('./update.js');
    await runUpdate({ confirm: opts.yes ?? false, checkOnly: opts.check ?? false });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  printError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
