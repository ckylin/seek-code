import type { Skill } from '../skills.js';
import type { SelectorItem } from '../../utils/select.js';

export type { Skill, SelectorItem };

export interface InputResult {
  text: string;
  cancelled: boolean;
}

export interface DropdownItem {
  value: string;
  label: string;
  desc?: string;
  kind?: 'builtin' | 'skill' | 'file';
}

export interface PromptInputProps {
  cwd: string;
  model?: string;
  skills: Skill[];
  activeSkill?: string;
  showMeta: boolean;
  onSubmit: (result: InputResult) => void;
}

export interface DropdownProps {
  items: DropdownItem[];
  selectedIndex: number;
  visible: boolean;
}

export interface ListPickerProps {
  title: string;
  items: SelectorItem[];
  currentValue?: string;
  onSubmit: (value: string | null) => void;
}
