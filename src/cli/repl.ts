import chalk from 'chalk';
import { runAgentLoop } from '../core/agent/loop.js';
import { ContextManager } from '../core/context/manager.js';
import { DeepSeekProvider } from '../providers/deepseek/provider.js';
import { createInterruptController, getActiveInterruptCount } from '../utils/interrupt.js';
import { drainInternalBuffer, forceRestoreTerminal } from '../utils/rawMode.js';

import { printError, printUserMessage } from '../utils/display.js';
import { resolveAtReferences } from './at-resolver.js';
import { handleSlashCommand } from './commands.js';
import { printBanner } from './banner.js';
import { readMultilineInput } from './input.js';
import { loadSkills } from './skills.js';
import { saveConfig, supportsReasoning, CONTEXT_BUDGET, CHAT_CONTEXT_BUDGET } from '../config.js';
import type { CodeGruntConfig, LLMProvider } from '../types.js';

// ── Harness-style: Pipeline / Events / Observability ─────────────────────
import { getLogger } from '../core/observability/logger.js';
import { getDefaultMetrics } from '../core/observability/metrics.js';

const log = getLogger('repl');

export async function startRepl(initialConfig: CodeGruntConfig, initialProvider: LLMProvider): Promise<void> {
  const cwd = process.cwd();
  const budget = supportsReasoning(initialConfig.model) ? CONTEXT_BUDGET : CHAT_CONTEXT_BUDGET;
  const context = new ContextManager(budget);

  let config = initialConfig;
  let provider: LLMProvider = initialProvider;
  let skills = await loadSkills(cwd);

  const metrics = getDefaultMetrics();

  // Fallback: if SIGINT fires outside raw-mode input (e.g. during agent run
  // when the interrupt controller has already been cleaned up), exit cleanly.
  process.on('SIGINT', () => {
    if (getActiveInterruptCount() > 0) return;
    forceRestoreTerminal();
    process.stdout.write(chalk.yellow('\nInterrupted.\n'));

    // Print metrics summary on exit if telemetry enabled
    if (process.env.CODEGRUNT_TELEMETRY === '1') {
      metrics.printSummary();
    }

    process.exit(0);
  });

  printBanner(config.model);

  // ── Main REPL loop (iterative, not recursive — avoids stack growth) ──
  while (true) {
    const result = await readMultilineInput(cwd, config.model, skills);

    if (result.cancelled) continue;

    const raw = result.text;
    if (!raw) continue;

    if (raw === 'exit' || raw === 'quit') {
      console.log(chalk.gray('Goodbye.'));
      if (process.env.CODEGRUNT_TELEMETRY === '1') {
        metrics.printSummary();
      }
      process.exit(0);
    }

    // Slash commands — only if "/" is immediately followed by a letter (no space)
    if (raw.startsWith('/') && raw.length > 1 && raw[1] !== ' ') {
      const cmd = await handleSlashCommand(raw, cwd, config, provider, context, skills);

      if (cmd.type === 'exit') {
        console.log(chalk.gray('Goodbye.'));
        if (process.env.CODEGRUNT_TELEMETRY === '1') {
          metrics.printSummary();
        }
        process.exit(0);
      }

      if (cmd.type === 'model_changed' || cmd.type === 'config_changed') {
        config = cmd.config;
        provider = new DeepSeekProvider(config);

        // Adjust context budget when switching between chat/reasoner
        const newBudget = supportsReasoning(config.model) ? CONTEXT_BUDGET : CHAT_CONTEXT_BUDGET;
        context.setTokenBudget(newBudget);

        await saveConfig(config).catch(() => {});
        if (cmd.type === 'model_changed') {
          console.log(chalk.gray(`  Active model: ${chalk.cyan(config.model)}\n`));
        } else {
          console.log(chalk.gray('  Configuration applied.\n'));
        }
      } else if (cmd.type === 'skill_run') {
        const skillName = raw.slice(1).split(' ')[0];
        const hasArgs = raw.slice(skillName.length + 1).trim().length > 0;
        const skillSystem = cmd.system ?? 'You are a helpful AI assistant. Follow the user\'s instructions carefully.';

        if (hasArgs) {
          printUserMessage(`/${raw.slice(1).split(' ')[0]}`);
          const skillBudget = supportsReasoning(config.model) ? CONTEXT_BUDGET : CHAT_CONTEXT_BUDGET;
          const skillContext = new ContextManager(skillBudget);
          const interrupt = createInterruptController();
          try {
            process.stdout.write('\n');
            await runAgentLoop({ task: cmd.prompt, cwd, config, provider, context: skillContext, systemPromptOverride: skillSystem, signal: interrupt.signal });
          } catch (err) {
            if ((err as Error)?.name === 'AbortError' || interrupt.signal.aborted) {
              process.stdout.write(chalk.yellow('\nInterrupted.\n'));
            } else {
              printError(err instanceof Error ? err.message : String(err));
              log.error('Skill run failed', { error: err instanceof Error ? err.message : String(err) });
            }
          } finally {
            interrupt.cleanup();
          }
          drainInternalBuffer();
        } else {
          await enterSkillMode(skillName, cmd.prompt, skillSystem);
        }
      } else if (cmd.type === 'skills_reload') {
        skills = await loadSkills(cwd);
        console.log(chalk.gray('Skills reloaded.\n'));
      }
      continue;
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
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || interrupt.signal.aborted) {
        process.stdout.write(chalk.yellow('\nInterrupted.\n'));
      } else {
        printError(err instanceof Error ? err.message : String(err));
        log.error('Agent loop failed', { error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      interrupt.cleanup();
    }

    drainInternalBuffer();
  }

  // ── Skill mode ────────────────────────────────────────────────────────
  async function enterSkillMode(skillName: string, skillContent: string, skillSystem?: string): Promise<void> {
    printUserMessage(`/${skillName}`);
    console.log(chalk.gray(`  [Skill "${skillName}"] — /exit 退出  |  空提交退出  |  Esc 清空输入\n`));

    const skillContext = new ContextManager(supportsReasoning(config.model) ? CONTEXT_BUDGET : CHAT_CONTEXT_BUDGET);
    drainInternalBuffer();

    while (true) {
      const skillResult = await readMultilineInput(cwd, config.model, skills, skillName);

      if (skillResult.cancelled) break;

      const rawText = skillResult.text.trim();

      if (!rawText || rawText === '/exit' || rawText === '/quit' || rawText === 'exit' || rawText === 'quit') break;

      const fullPrompt = `${skillContent}\n\n---\n${rawText}`;
      const interrupt = createInterruptController();
      try {
        process.stdout.write('\n');
        await runAgentLoop({ task: fullPrompt, cwd, config, provider, context: skillContext, systemPromptOverride: skillSystem, signal: interrupt.signal });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError' || interrupt.signal.aborted) {
          process.stdout.write(chalk.yellow('\nInterrupted.\n'));
        } else {
          printError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        interrupt.cleanup();
      }

      drainInternalBuffer();
    }

    drainInternalBuffer();
    console.log(chalk.gray('  已退出 skill.\n'));
  }
}
