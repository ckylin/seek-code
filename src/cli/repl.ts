import chalk from 'chalk';
import { runAgentLoop } from '../core/agent/loop.js';
import { ContextManager } from '../core/context/manager.js';
import { DeepSeekProvider } from '../providers/deepseek/provider.js';
import { createInterruptController } from '../utils/interrupt.js';
import { printError, printUserMessage } from '../utils/display.js';
import { resolveAtReferences } from './at-resolver.js';
import { handleSlashCommand } from './commands.js';
import { printBanner } from './banner.js';
import { readMultilineInput } from './input.js';
import { loadSkills } from './skills.js';
import { saveConfig, supportsReasoning, CONTEXT_BUDGET, CHAT_CONTEXT_BUDGET } from '../config.js';
import type { CodeGruntConfig, LLMProvider } from '../types.js';

/**
 * Drain any buffered stdin data. Safe to call after readMultilineInput
 * returns (which pauses stdin and removes its data listener).
 *
 * Uses both read() and a temporary flowing-mode listener to reliably
 * consume data on all platforms. Without a listener, resume() on Windows
 * may not actually pull data from the OS buffer.
 */
async function drainStdin(): Promise<void> {
  if (!process.stdin.isTTY) return;

  // First, drain anything already in Node's internal buffer (works in paused mode).
  while (process.stdin.read() !== null) { /* drain */ }

  // Attach a temporary data listener so that resume() actually consumes
  // data from the OS buffer (important on Windows).
  const noop = (): void => {};
  process.stdin.on('data', noop);
  process.stdin.resume();

  // Wait for any lingering OS-buffered data to be delivered.
  await new Promise<void>((res) => setTimeout(res, 50));

  process.stdin.removeListener('data', noop);
  process.stdin.pause();

  // Final sweep — catch anything that arrived during the wait.
  while (process.stdin.read() !== null) { /* drain */ }
}

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
    process.stdout.write(chalk.yellow('\nInterrupted.\n'));
    process.exit(0);
  });

  printBanner(config.model);

  const loop = async (): Promise<void> => {
    const result = await readMultilineInput(cwd, config.model, skills);

    if (result.cancelled) { await loop(); return; }

    const raw = result.text;
    if (!raw) { await loop(); return; }

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
          await drainStdin();
        } else {
          // No args: enter skill mode with a dedicated input box
          await enterSkillMode(skillName, cmd.prompt, skillSystem);
        }
      } else if (cmd.type === 'skills_reload') {
        skills = await loadSkills(cwd);
        console.log(chalk.gray('Skills reloaded.\n'));
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

    // Drain stray keystrokes that landed during the agent run so they
    // don't leak into the next readMultilineInput panel.
    await drainStdin();

    await loop();
  };

  /**
   * Enter skill interaction mode: multi-turn conversation scoped to the skill.
   * Uses an isolated ContextManager seeded with recent main-context messages.
   * Type /exit, exit, /quit, quit, or submit an empty line to exit back to the main loop.
   */
  const enterSkillMode = async (skillName: string, skillContent: string, skillSystem?: string): Promise<void> => {
    printUserMessage(`/${skillName}`);
    console.log(chalk.gray(`  [Skill "${skillName}"] — /exit 退出  |  空提交退出  |  Esc 清空输入\n`));

    // Fresh isolated context for skill mode — prevents main conversation
    // history (especially code-related tool calls) from leaking in and
    // confusing the LLM about what it should be doing.
    const skillContext = new ContextManager(supportsReasoning(config.model) ? CONTEXT_BUDGET : CHAT_CONTEXT_BUDGET);

    // Drain buffered data from the Enter key that submitted /skill-name.
    // Without this, the first readMultilineInput in the skill loop may
    // receive leftover bytes and return immediately with empty input,
    // causing the input panel to "disappear".
    await drainStdin();

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

      // Drain buffered data that accumulated during the agent run
      // (e.g. accidental key presses while watching the AI response).
      // Without this, buffered characters (especially Enter) will be
      // read by the next readMultilineInput and may trigger an immediate
      // empty submit, exiting skill mode and hiding the input panel.
      await drainStdin();
    }

    // Drain again after exiting the skill loop, so any leftover bytes
    // from the final submit don't leak into the main REPL loop's first
    // readMultilineInput and corrupt its render.
    await drainStdin();

    console.log(chalk.gray('  已退出 skill.\n'));
  };

  await loop();
}
