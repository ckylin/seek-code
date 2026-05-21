import chalk from 'chalk';
import { runAgentLoop } from '../core/agent/loop.js';
import { ContextManager } from '../core/context/manager.js';
import { DeepSeekProvider } from '../providers/deepseek/provider.js';
import { createInterruptController, getActiveInterruptCount } from '../utils/interrupt.js';
import { drainInternalBuffer } from '../utils/rawMode.js';
import { printError, printUserMessage } from '../utils/display.js';
import { resolveAtReferences } from './at-resolver.js';
import { handleSlashCommand } from './commands.js';
import { printBanner } from './banner.js';
import { readMultilineInput } from './input.js';
import { loadSkills } from './skills.js';
import { saveConfig, supportsReasoning, CONTEXT_BUDGET, CHAT_CONTEXT_BUDGET } from '../config.js';
import type { CodeGruntConfig, LLMProvider } from '../types.js';

export async function startRepl(initialConfig: CodeGruntConfig, initialProvider: LLMProvider): Promise<void> {
  const cwd = process.cwd();
  const budget = supportsReasoning(initialConfig.model) ? CONTEXT_BUDGET : CHAT_CONTEXT_BUDGET;
  const context = new ContextManager(budget);

  let config = initialConfig;
  let provider: LLMProvider = initialProvider;
  let skills = await loadSkills(cwd);

  // Fallback: if SIGINT fires outside raw-mode input (e.g. during agent run
  // when the interrupt controller has already been cleaned up), exit cleanly.
  process.on('SIGINT', () => {
    if (getActiveInterruptCount() > 0) return;
    process.stdout.write(chalk.yellow('\nInterrupted.\n'));
    process.exit(0);
  });

  printBanner(config.model);

  // ── Main REPL loop (iterative, not recursive — avoids stack growth) ──────
  while (true) {
    const result = await readMultilineInput(cwd, config.model, skills);

    if (result.cancelled) continue;

    const raw = result.text;
    if (!raw) continue;

    if (raw === 'exit' || raw === 'quit') {
      console.log(chalk.gray('Goodbye.'));
      process.exit(0);
    }

    // Slash commands — only if "/" is immediately followed by a letter (no space)
    if (raw.startsWith('/') && raw.length > 1 && raw[1] !== ' ') {
      const cmd = await handleSlashCommand(raw, cwd, config, provider, context, skills);

      if (cmd.type === 'exit') {
        console.log(chalk.gray('Goodbye.'));
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
        // If the skill doesn't define its own system prompt, use a neutral
        // default so the coding-assistant identity doesn't interfere with
        // the skill's role (e.g. Bazi master, translator, etc.).
        const skillSystem = cmd.system ?? 'You are a helpful AI assistant. Follow the user\'s instructions carefully.';

        if (hasArgs) {
          // Inline args: /skill-name args... — run immediately
          printUserMessage(`/${raw.slice(1).split(' ')[0]}`);
          // Use a fresh context for skill runs so the coding-assistant system
          // prompt doesn't conflict with the skill's role (e.g. Bazi master).
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
            }
          } finally {
            interrupt.cleanup();
          }
          drainInternalBuffer();
        } else {
          // No args: enter skill mode with a dedicated input box
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

    printUserMessage(raw);

    const interrupt = createInterruptController();
    try {
      process.stdout.write('\n');
      await runAgentLoop({ task, cwd, config, provider, context, signal: interrupt.signal });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || interrupt.signal.aborted) {
        process.stdout.write(chalk.yellow('\nInterrupted.\n'));
      } else {
        printError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      interrupt.cleanup();
    }

    // Drain stray keystrokes that landed in Node's internal buffer during the
    // agent run so they don't leak into the next readMultilineInput panel.
    // The interrupt controller's listener already consumed OS-level keystrokes
    // in real time, so a simple internal-buffer drain is sufficient here.
    drainInternalBuffer();
  }

  /**
   * Enter skill interaction mode: multi-turn conversation scoped to the skill.
   * Uses an isolated ContextManager seeded with recent main-context messages.
   * Type /exit, exit, /quit, quit, or submit an empty line to exit back to the main loop.
   */
  async function enterSkillMode(skillName: string, skillContent: string, skillSystem?: string): Promise<void> {
    printUserMessage(`/${skillName}`);
    console.log(chalk.gray(`  [Skill "${skillName}"] — /exit 退出  |  空提交退出  |  Esc 清空输入\n`));

    // Fresh isolated context for skill mode — prevents main conversation
    // history (especially code-related tool calls) from leaking in and
    // confusing the LLM about what it should be doing.
    const skillContext = new ContextManager(supportsReasoning(config.model) ? CONTEXT_BUDGET : CHAT_CONTEXT_BUDGET);

    // Drain buffered data from the Enter key that submitted /skill-name.
    drainInternalBuffer();

    while (true) {
      const skillResult = await readMultilineInput(cwd, config.model, skills, skillName);

      if (skillResult.cancelled) break;

      const rawText = skillResult.text.trim();

      // Empty input or explicit exit commands leave skill mode
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

    // Drain again after exiting the skill loop so any leftover bytes from the
    // final submit don't leak into the main REPL loop's readMultilineInput.
    drainInternalBuffer();

    console.log(chalk.gray('  已退出 skill.\n'));
  }
}
