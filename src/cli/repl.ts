import chalk from 'chalk';
import { runAgentLoop } from '../core/agent/loop.js';
import { ContextManager } from '../core/context/manager.js';
import { DeepSeekProvider } from '../providers/deepseek/provider.js';
import { createInterruptController } from '../utils/interrupt.js';
import { printError } from '../utils/display.js';
import { resolveAtReferences } from './at-resolver.js';
import { handleSlashCommand } from './commands.js';
import { printBanner } from './banner.js';
import { readMultilineInput } from './input.js';
import type { SeekCodeConfig, LLMProvider } from '../types.js';

export async function startRepl(initialConfig: SeekCodeConfig, initialProvider: LLMProvider): Promise<void> {
  const cwd = process.cwd();
  const context = new ContextManager(Math.floor(initialConfig.maxTokens * 7));

  let config = initialConfig;
  let provider: LLMProvider = initialProvider;

  printBanner(config.model);

  const loop = async (): Promise<void> => {
    let result;
    try {
      result = await readMultilineInput(cwd);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        process.stdout.write(chalk.yellow('Interrupted.\n'));
        process.exit(0);
      }
      throw err;
    }

    if (result.cancelled) { await loop(); return; }

    const raw = result.text;
    if (!raw) { await loop(); return; }

    if (raw === 'exit' || raw === 'quit') {
      console.log(chalk.gray('Goodbye.'));
      process.exit(0);
    }

    // Slash commands
    if (raw.startsWith('/')) {
      const cmd = await handleSlashCommand(raw, cwd, config, provider, context);
      if (cmd.type === 'model_changed') {
        config = cmd.config;
        provider = new DeepSeekProvider(config);
        console.log(chalk.gray(`  Active model: ${chalk.cyan(config.model)}\n`));
      }
      await loop();
      return;
    }

    // @ references
    const { expanded: task, refs } = await resolveAtReferences(raw, cwd);
    if (refs.length > 0) {
      const labels = refs.map((r) => chalk.cyan(r.raw)).join(', ');
      process.stdout.write(chalk.gray(`  Injecting: ${labels}\n`));
    }

    const interrupt = createInterruptController();
    try {
      process.stdout.write('\n');
      await runAgentLoop({ task, cwd, config, provider, context, signal: interrupt.signal });
      process.stdout.write('\n');
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || interrupt.signal.aborted) {
        process.stdout.write(chalk.yellow('\nInterrupted.\n'));
      } else {
        printError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      interrupt.cleanup();
    }

    await loop();
  };

  await loop();
}
