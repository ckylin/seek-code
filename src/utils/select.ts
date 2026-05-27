import React from 'react';
import { render } from 'ink';
import { ListPicker } from '../cli/ink/ListPicker.js';

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
  if (!process.stdin.isTTY) return null;

  return new Promise((resolve) => {
    const { unmount } = render(
      React.createElement(ListPicker, {
        title,
        items,
        currentValue,
        onSubmit: (value) => {
          unmount();
          resolve(value);
        },
      }),
    );
  });
}
