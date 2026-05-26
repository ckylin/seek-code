import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ACCENT } from '../../utils/constants.js';
import type { ListPickerProps } from './types.js';
import type { SelectorItem } from '../../utils/select.js';

export function ListPicker({ title, items, currentValue, onSubmit }: ListPickerProps): React.ReactElement {
  const initialIndex = Math.max(0, items.findIndex(i => i.value === currentValue));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(items.length - 1, i + 1));
    } else if (key.return) {
      onSubmit(items[selectedIndex]?.value ?? null);
    } else if (key.escape || (key.ctrl && _input === 'c')) {
      onSubmit(null);
    }
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold>{title}</Text>
      </Box>
      {items.map((item: SelectorItem, i: number) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={item.value}>
            <Text color={ACCENT}>{isSelected ? '❯ ' : '  '}</Text>
            <Text
              color={item.kind === 'skill' ? 'white' : ACCENT}
              bold={isSelected}
              dimColor={!isSelected}
            >
              {item.label}
            </Text>
            {item.desc ? (
              <Text dimColor>{'  ' + item.desc}</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
