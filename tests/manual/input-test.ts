/**
 * Standalone test for readMultilineInput — isolates the raw-mode UI from the
 * agent loop / API calls so you can iterate on terminal interaction quickly.
 *
 * Usage:  npx tsx tests/manual/input-test.ts
 *
 * Type normally, test slash commands (/), @-file completions, arrow keys, etc.
 * Press Enter to submit.  Ctrl+C to quit.
 */

import { readMultilineInput } from '../../src/cli/input.js';

async function main() {
  console.log('=== readMultilineInput 独立测试 ===\n');
  console.log('  输入 / 触发 slash command 下拉');
  console.log('  输入 @ 触发文件路径补全');
  console.log('  方向键 导航/历史');
  console.log('  Tab 选中下拉项');
  console.log('  Enter 提交');
  console.log('  Ctrl+J 换行');
  console.log('  Ctrl+C 退出\n');

  const result = await readMultilineInput(
    process.cwd(),
    'test-model',  // 模拟一个 model 名
    [],            // skills 列表，可以手动加几个测试
    undefined,     // activeSkill
  );

  console.log('\n--- 结果 ---');
  console.log('text:', JSON.stringify(result.text));
  console.log('cancelled:', result.cancelled);
}

main().catch(console.error);
