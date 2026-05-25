import { select } from '@inquirer/prompts';
import { ACCENT } from './constants.js';
import chalk from 'chalk';

export interface SelectorItem {
  value: string;
  label: string;
  desc?: string;
  kind?: 'builtin' | 'skill';
}

export async function selectFromList(
  title: string,
  items: SelectorItem[],
  currentValue?: string,
): Promise<string | null> {
  if (items.length === 0) return null;

  try {
    const result = await select<string>({
      message: title,
      choices: items.map((i) => ({
        name: i.kind === 'skill'
          ? chalk.white(i.label) + (i.desc ? chalk.gray('  ' + i.desc) : '')
          : chalk.hex(ACCENT)(i.label) + (i.desc ? chalk.gray('  ' + i.desc) : ''),
        value: i.value,
        short: i.label,
      })),
      default: currentValue,
      theme: {
        icon: { cursor: chalk.hex(ACCENT)('❯') },
        style: {
          highlight: (text: string) => chalk.bold.hex(ACCENT)(text),
        },
      },
    });
    return result;
  } catch {
    // Ctrl+C or Esc
    return null;
  }
}
