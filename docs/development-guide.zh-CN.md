# Seek Code — 开发者指南

> 如何从源码构建、测试和贡献 Seek Code。

---

## 目录

- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [构建系统](#构建系统)
- [开发工作流](#开发工作流)
- [测试](#测试)
- [架构概览](#架构概览)
- [添加新的 LLM 提供商](#添加新的-llm-提供商)
- [添加新工具](#添加新工具)
- [配置系统](#配置系统)
- [发布流程](#发布流程)
- [常见问题排查](#常见问题排查)

---

## 环境要求

| 依赖 | 最低版本 |
|---|---|
| [Node.js](https://nodejs.org/) | 18.x（推荐 LTS） |
| [npm](https://www.npmjs.com/) | 9.x（Node 18+ 自带） |
| [Git](https://git-scm.com/) | 2.x |
| [TypeScript](https://www.typescriptlang.org/) | 5.5+（通过 npm install 安装） |

可选但推荐：

- [pnpm](https://pnpm.io/) — 比 npm 更快的包管理器
- [tsx](https://tsx.is/) — 用于开发热重载（已包含在 devDependencies 中）

---

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/your-org/seekcode.git
cd seekcode
```

### 2. 安装依赖

```bash
npm install
```

安装 package.json 中定义的所有运行时和开发依赖。

### 3. 构建项目

```bash
npm run build
```

将 TypeScript 从 src/ 编译为 JavaScript 到 dist/。输出用于 npm start 命令和发布的 npm 包。

### 4. 验证构建

```bash
npm start -- --help
```

你应该能看到 CLI 帮助输出。如果看到 Error: No API key configured，这是正常的——你需要设置 API 密钥才能使用工具，但构建本身已成功。

### 5. （可选）全局链接

```bash
npm link
```

现在你可以在终端中任何位置运行 seekcode。

---

## 项目结构

```
seekcode/
├── src/
│   ├── cli/                  # CLI 入口、REPL、参数解析
│   │   ├── index.ts          # 入口（基于 commander 的 CLI）
│   │   ├── repl.ts           # 交互式 REPL 循环
│   │   ├── input.ts          # 多行输入、Tab 补全、列表选择器
│   │   ├── commands.ts       # 斜杠命令（/help, /model, /init 等）
│   │   ├── setup.ts          # 首次运行设置向导
│   │   ├── banner.ts         # ASCII 艺术横幅
│   │   └── at-resolver.ts    # @文件/@URL 引用展开
│   ├── core/
│   │   ├── agent/
│   │   │   └── loop.ts       # 代理循环——核心推理/行动循环
│   │   ├── tools/
│   │   │   ├── registry.ts   # 工具注册和查找
│   │   │   ├── executor.ts   # 工具执行（含用户确认）
│   │   │   ├── read_file.ts
│   │   │   ├── write_file.ts
│   │   │   ├── edit_file.ts
│   │   │   ├── execute_shell.ts
│   │   │   ├── list_directory.ts
│   │   │   └── search_files.ts
│   │   └── context/
│   │       ├── manager.ts    # 上下文窗口管理（Token 预算、裁剪）
│   │       └── project-guide.ts  # 加载 SEEK.md / CLAUDE.md 项目指南
│   ├── providers/
│   │   └── deepseek/
│   │       ├── provider.ts   # DeepSeek LLM 提供商实现
│   │       └── client.ts     # OpenAI 兼容客户端工厂
│   ├── utils/
│   │   ├── display.ts        # 终端输出格式化
│   │   ├── confirm.ts        # Diff 预览和用户确认
│   │   └── interrupt.ts      # SIGINT 处理
│   ├── config.ts             # 配置加载（环境变量、配置文件）
│   └── types.ts              # 共享 TypeScript 类型和接口
├── tests/
│   ├── tools/
│   │   ├── read_file.test.ts
│   │   ├── write_file.test.ts
│   │   └── execute_shell.test.ts
├── docs/                     # 文档
├── dist/                     # 编译输出（gitignore）
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md                 # AI 编码助手项目指南
└── README.md
```

---

## 构建系统

### 编译

Seek Code 使用标准 TypeScript 编译器（tsc）进行生产构建。

```bash
npm run build          # 编译 src/ → dist/
npm run typecheck      # 仅类型检查，不输出文件
```

tsconfig.json 配置要点：

- target: ES2022 — 现代 JS 输出
- module: ESNext — ESM 模块系统
- moduleResolution: bundler — 兼容 tsx 和 tsc
- strict: true — 完整严格模式
- declaration: true — 生成 .d.ts 文件
- sourceMap: true — 调试源码映射

关键点：

- **仅 ESM**：项目在 package.json 中使用 "type": "module"。所有导入使用 .js 扩展名约定（例如 import { foo } from './bar.js'）。
- **bundler 解析**：兼容 tsx（开发）和 tsc（生产）。
- **declaration: true**：为使用者生成 .d.ts 类型声明文件。

### 开发 vs 生产

| 模式 | 命令 | 运行方式 |
|---|---|---|
| 开发 | npm run dev | tsx watch src/cli/index.ts — 文件变更时热重载 |
| 生产 | npm run build 然后 npm start | 运行编译后的 dist/cli/index.js |
| 单次任务（开发） | npx tsx src/cli/index.ts "任务" | 直接执行，无需 watch |

### 模块系统

项目仅使用 ES Modules (ESM)：

- package.json 包含 "type": "module"
- 所有导入使用 import/export 语法
- 导入中的文件扩展名使用 .js（TypeScript 的 ESM 约定）
- 动态导入使用 import() 语法

---

## 开发工作流

### 交互式开发

最快的方式是使用 watch 模式：

```bash
npm run dev
```

这会以 tsx watch 启动 REPL，当你保存 src/ 中任何文件的更改时自动重启。无需手动重新编译。

### 单次任务

快速测试特定功能：

```bash
npx tsx src/cli/index.ts "列出当前目录的文件"
```

### 类型检查

单独运行类型检查以捕获类型错误，无需编译：

```bash
npm run typecheck
```

### 调试

#### 源码映射调试

已启用源码映射（tsconfig.json 中的 sourceMap: true），因此你可以在 Node.js 中调试编译后的输出：

```bash
node --inspect dist/cli/index.js
```

或直接使用 tsx 调试（推荐，无需先构建）：

```bash
node --inspect --import tsx src/cli/index.ts
```

然后在 Chrome 浏览器中打开 `chrome://inspect`，点击 "Open dedicated DevTools for Node" 即可开始调试。

#### 使用 console.error 输出调试信息

由于 Seek Code 的工具输出通过 stdout 传递，请使用 `console.error()` 输出调试信息——它会输出到 stderr，不会干扰工具输出解析：

```typescript
// ✅ 正确：使用 console.error 调试
console.error('[调试] 工具参数:', params);

// ❌ 错误：使用 console.log 会污染工具输出
console.log('[调试] 工具参数:', params);
```

#### 调试代理循环（Agent Loop）

代理循环（`src/core/agent/loop.ts`）是 Seek Code 的核心。调试代理循环时，可以关注以下关键点：

1. **系统提示构建**：检查系统提示是否正确包含项目指南（SEEK.md/CLAUDE.md）内容
2. **消息历史**：在 `ContextManager` 中打印当前消息列表，确认上下文裁剪是否正常
3. **工具调用解析**：检查 LLM 返回的 tool_call 参数是否被正确解析
4. **流式输出**：确认 text_delta、reasoning_delta、tool_call_delta 等流式块是否正确处理

在 `loop.ts` 中添加临时调试输出：

```typescript
// 在关键位置插入调试日志
console.error('[Agent Loop] 迭代次数:', iteration);
console.error('[Agent Loop] 消息数量:', messages.length);
console.error('[Agent Loop] 工具调用:', toolCalls);
```

#### 调试工具执行

工具执行器（`src/core/tools/executor.ts`）负责执行 LLM 调用的工具。调试工具执行时：

1. **检查工具注册**：确认工具已在 `registry.ts` 中正确注册
2. **验证参数解析**：检查 LLM 传入的参数是否与工具定义的参数模式匹配
3. **查看执行结果**：检查工具返回的 `ToolResult` 结构是否正确

```typescript
// 在 executor.ts 中添加调试日志
console.error('[Executor] 执行工具:', toolName);
console.error('[Executor] 参数:', JSON.stringify(args));
console.error('[Executor] 结果:', JSON.stringify(result));
```

#### 调试 LLM 提供商

调试 LLM 提供商（如 `src/providers/deepseek/provider.ts`）时：

1. **检查 API 请求**：确认发送给 API 的消息格式是否正确
2. **检查 API 响应**：查看原始 API 响应中的流式块
3. **检查错误处理**：确认 API 错误被正确捕获和传递

```typescript
// 在 provider.ts 中添加调试日志
console.error('[Provider] 请求模型:', options.model);
console.error('[Provider] 消息数:', messages.length);
console.error('[Provider] 工具定义数:', options.tools?.length);
```

#### 调试上下文管理

上下文管理器（`src/core/context/manager.ts`）负责 Token 预算和消息裁剪。调试时：

```typescript
// 在 manager.ts 中添加调试日志
console.error('[Context] 当前 Token 估算:', estimatedTokens);
console.error('[Context] Token 预算:', budget);
console.error('[Context] 裁剪后消息数:', messages.length);
```

#### 常见调试场景

| 场景 | 调试方法 |
|---|---|
| LLM 返回空响应 | 检查 API 密钥是否有效，网络是否连通 |
| 工具调用失败 | 在 executor.ts 中添加日志，检查参数格式 |
| 上下文被意外裁剪 | 在 manager.ts 中打印 Token 估算值和裁剪日志 |
| 流式输出卡顿 | 检查 provider 的流式迭代器是否正确 yield 数据块 |
| 类型错误 | 运行 `npm run typecheck` 定位类型不匹配 |
| 构建成功但运行时行为异常 | 检查 `dist/` 输出文件确认编译结果 |

#### 使用测试进行调试

编写或运行测试是验证工具行为的最可靠方式：

```bash
# 运行单个测试文件快速验证
npx vitest run tests/tools/read_file.test.ts

# 使用 --reporter=verbose 获取详细输出
npx vitest --reporter=verbose

# 使用 watch 模式在修改代码时自动重跑测试
npx vitest
```

---

## 测试

### 运行测试

```bash
npm test                          # 运行所有测试
npx vitest run                    # 同上
npx vitest                        # 监视模式
```

### 运行单个测试文件

```bash
npx vitest run tests/tools/read_file.test.ts
npx vitest run tests/tools/write_file.test.ts
npx vitest run tests/tools/execute_shell.test.ts
```

> **注意：** 目前 6 个工具中只有 3 个有测试文件。`edit_file`、`list_directory` 和 `search_files` 的测试尚未实现。欢迎贡献添加这些测试！

### 详细输出

```bash
npx vitest --reporter=verbose
```

### 测试结构

测试位于 tests/ 目录，镜像 src/ 的结构。测试框架是 Vitest，在 vitest.config.ts 中配置。

关键特性：

- **不需要 API 密钥**：工具层单元测试在本地文件系统和 shell 上操作，不针对任何 LLM。
- **隔离的文件系统**：测试使用临时目录以避免副作用。
- **异步测试**：大多数工具测试是异步的，因为它们涉及 I/O 操作。

### 编写测试

测试结构示例：

```typescript
import { describe, it, expect } from 'vitest';
import { readFileTool } from '../../src/core/tools/read_file.js';

describe('read_file', () => {
  it('读取已存在的文件', async () => {
    const result = await readFileTool.execute({ path: 'package.json' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('"name": "seekcode"');
  });

  it('不存在的文件返回错误', async () => {
    const result = await readFileTool.execute({ path: 'nonexistent.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to read');
  });
});
```

---

## 架构概览

### 高层流程

```
用户输入 (CLI / REPL)
       │
       ▼
  ┌─────────────┐
  │  代理循环    │ ◄──── LLM 提供商（流式）
  │  (loop.ts)  │ ────► 工具执行
  └──────┬──────┘
         │
    ┌────┴────┐
    │  工具    │
    │ (6 个)   │
    └─────────┘
```

### 代理循环（src/core/agent/loop.ts）

代理循环是 Seek Code 的核心。它遵循 ReAct（推理 + 行动）模式：

1. **系统提示** 在每个会话中构建一次（保持稳定以最大化提示缓存命中率）。
2. **用户消息** 附加 [cwd] 和 [date] 前缀。
3. **流式响应** 来自 LLM——处理文本增量、推理增量和工具调用增量。
4. **如果收到工具调用**，执行每个工具并将结果反馈给 LLM。
5. **如果是文本响应**（finish_reason = "stop"），输出给用户并结束。
6. **循环** 最多 30 次迭代以处理多步骤任务。

关键设计决策：

- **系统提示稳定性**：系统提示只构建一次，在会话期间不会更改。这最大化 DeepSeek 的提示缓存命中率。
- **上下文管理**：ContextManager 跟踪 Token 使用情况，当超出预算时裁剪旧消息。
- **流式优先**：所有 LLM 通信通过 AsyncIterable 流式传输，实现实时终端输出。

### 工具系统

工具是 LLM 与用户环境交互的机制。每个工具实现 Tool 接口。

六个内置工具：

| 工具 | 描述 |
|---|---|
| read_file | 读取文件内容（截断至 8000 字符） |
| write_file | 写入内容到文件（自动创建目录） |
| edit_file | 替换文件中的精确字符串 |
| execute_shell | 运行 shell 命令（带超时） |
| list_directory | 列出目录树（可配置深度） |
| search_files | 在文件中搜索文本模式 |

**安全性**：在破坏性操作（write_file、edit_file）之前，执行器会显示 diff 预览并请求用户确认。

### 上下文管理（src/core/context/manager.ts）

ContextManager 维护对话历史：

- **Token 估算**：使用简单的 4:1 字符与 Token 比率。
- **裁剪**：当估算的 Token 数超过预算时，移除最旧的非系统消息。
- **预算**：默认为 maxTokens * 7。

### 提供商系统

所有 LLM 后端实现 LLMProvider 接口。StreamChunk 联合类型支持：

- text_delta — 增量文本输出
- reasoning_delta — 思维链推理（显示为 Thinking...）
- tool_call_delta — 流式工具调用参数
- finish — 流结束，包含结束原因

---

## 添加新的 LLM 提供商

### 步骤 1：创建提供商目录

```bash
mkdir -p src/providers/myprovider
```

### 步骤 2：实现提供商

```typescript
// src/providers/myprovider/provider.ts
import type { LLMProvider, Message, RequestOptions, StreamChunk } from '../../types.js';

export class MyProvider implements LLMProvider {
  readonly id = 'my-provider';

  async *stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk> {
    for await (const chunk of yourApiCall(messages, options)) {
      if (chunk.type === 'text') {
        yield { type: 'text_delta', text: chunk.content };
      }
    }
    yield { type: 'finish', finish_reason: 'stop' };
  }
}
```

### 步骤 3：注册提供商

在 src/cli/index.ts 中：

```typescript
import { MyProvider } from './providers/myprovider/provider.js';
const provider = new MyProvider(config);
```

### 步骤 4：添加配置支持

更新 src/config.ts 以支持你的提供商的配置。

### 提供商契约

你的提供商必须：

1. 接受 OpenAI 兼容格式的 Message[]
2. 返回 AsyncIterable
3. 支持 AbortSignal 用于取消
4. 处理工具定义（通过 options.tools 传递）
5. 尊重 options.model、options.maxTokens、options.temperature

---

## 添加新工具

### 步骤 1：创建工具文件

```typescript
// src/core/tools/my_tool.ts
import type { Tool, ToolResult } from '../../types.js';

export const myTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'my_tool',
      description: '这个工具做什么',
      parameters: {
        type: 'object',
        properties: {
          param1: { type: 'string', description: 'param1 的描述' },
        },
        required: ['param1'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      return { success: true, output: '结果字符串' };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
```

### 步骤 2：注册工具

添加到 src/core/tools/registry.ts：

```typescript
import { myTool } from './my_tool.js';

const ALL_TOOLS: Tool[] = [
  readFileTool, writeFileTool, editFileTool,
  executeShellTool, listDirectoryTool, searchFilesTool,
  myTool,
];
```

### 步骤 3：添加安全确认（如果是破坏性操作）

在 src/core/tools/executor.ts 中添加确认逻辑。

### 步骤 4：编写测试

```typescript
// tests/tools/my_tool.test.ts
import { describe, it, expect } from 'vitest';
import { myTool } from '../../src/core/tools/my_tool.js';

describe('my_tool', () => {
  it('正确工作', async () => {
    const result = await myTool.execute({ param1: 'test' });
    expect(result.success).toBe(true);
  });
});
```

---

## 斜杠命令

Seek Code 在交互式 REPL 中提供了一组斜杠命令，实现在 `src/cli/commands.ts` 中。

| 命令 | 描述 |
|---|---|
| `/help` | 显示可用命令 |
| `/model <名称>` | 切换活跃的 LLM 模型 |
| `/provider <ID>` | 切换活跃的 LLM 提供商 |
| `/init` | 重新运行设置向导以配置 API 密钥 |
| `/clear` | 清除对话历史 |
| `/exit` 或 `/quit` | 退出 REPL |
| `/cost` | 显示当前会话的 Token 使用量和预估费用 |

---

## @-引用语法

Seek Code 在 REPL 和单次任务模式中支持 `@`-引用，实现在 `src/cli/at-resolver.ts`。这让你可以直接在提示中引用文件和 URL。

### 文件引用

```bash
# 引用文件——文件内容会被内联到提示中
seekcode "解释 @src/core/agent/loop.ts"

# 引用多个文件
seekcode "比较 @src/config.ts 和 @src/types.ts"

# 带行号的引用（如果解析器支持）
seekcode "修复 @src/cli/index.ts:42-56 中的 bug"
```

### URL 引用

```bash
# 引用 URL——内容会被获取并内联
seekcode "总结 @https://example.com/docs/api"
```

### 工作原理

当输入包含 `@<路径>` 或 `@<URL>` 时，`at-resolver.ts` 模块会：

1. 检测输入字符串中的 `@` 标记
2. 对于文件路径：读取文件内容，用文件名前缀 + 文件内容替换 `@路径`
3. 对于 URL：获取 URL 内容并内联
4. 展开后的内容作为用户消息的一部分发送给 LLM

这在提供上下文时特别有用，无需手动复制文件内容。

---

## 首次运行设置向导

当首次启动 Seek Code 且未配置 API 密钥时，会运行设置向导（`src/cli/setup.ts`）。

### 功能

1. **检测缺少配置** — 检查是否设置了 `DEEPSEEK_API_KEY` 或存在 `~/.seekcode/config.json`
2. **提示输入 API 密钥** — 要求用户输入 DeepSeek API 密钥
3. **保存配置** — 将密钥写入 `~/.seekcode/config.json`
4. **验证密钥** — 进行测试 API 调用以确认密钥有效

### 跳过向导

可以通过预先配置来跳过向导：

```bash
export DEEPSEEK_API_KEY=sk-xxxxxxxx
# 或手动创建 ~/.seekcode/config.json
```

---

## 项目指南系统

Seek Code 会自动加载项目根目录中的 `SEEK.md` 或 `CLAUDE.md` 文件作为项目级指导，实现在 `src/core/context/project-guide.ts`。

### 工作原理

1. 启动时，Seek Code 在当前工作目录查找 `SEEK.md` 或 `CLAUDE.md`
2. 如果找到，文件内容会被附加到系统提示中
3. 这样每个项目都可以为 AI 助手定义自定义指令

### 示例 `SEEK.md`

```markdown
# SEEK.md

该文件为 Seek Code 在此项目中工作时提供指导。

## 命令
npm run test        # 运行测试
npm run lint        # 运行 linter
npm run build       # 编译

## 约定
- 在 React 中使用函数式组件
- 优先使用命名导出而非默认导出
- 为新功能编写测试
```

### 优先级

如果 `SEEK.md` 和 `CLAUDE.md` 同时存在，`SEEK.md` 优先。

---

## 配置系统

### 配置来源（按优先级排序）

1. **环境变量**（最高优先级）
2. **~/.seekcode/config.json**（用户配置文件）
3. **硬编码默认值**（最低优先级）

### 环境变量

| 变量 | 描述 | 默认值 |
|---|---|---|
| DEEPSEEK_API_KEY | DeepSeek API 密钥 | — |
| SEEKCODE_MODEL | 模型 ID | deepseek-v4-flash |
| SEEKCODE_PROVIDER | 提供商 ID | deepseek |
| SEEKCODE_MAX_TOKENS | 每次响应最大 Token 数 | 8192 |
| SEEKCODE_TEMPERATURE | 温度参数 | 0.2 |
| SEEKCODE_BASE_URL | API 基础 URL | https://api.deepseek.com |

### 配置文件位置

~/.seekcode/config.json

```json
{
  "apiKey": "sk-...",
  "model": "deepseek-v4-pro",
  "maxTokens": 8192,
  "temperature": 0.2,
  "provider": "deepseek",
  "baseURL": "https://api.deepseek.com"
}
```

---

## 发布流程

### 创建发布版本

```bash
npm version patch        # 更新版本号
npm run build            # 构建
npm test                 # 运行测试
npm publish              # 发布到 npm
git tag v$(node -p "require('./package.json').version")
git push origin --tags   # 推送标签
```

### 版本约定

- **补丁**（0.1.0 → 0.1.1）：Bug 修复、小改进
- **次要**（0.1.0 → 0.2.0）：新功能，向后兼容
- **主要**（0.x → 1.0.0）：破坏性变更，稳定版本

---

## 常见问题排查

### 构建错误

| 症状 | 可能原因 | 解决方案 |
|---|---|---|
| Cannot find module 'x' | 缺少依赖 | npm install |
| Type error TS2304 | 缺少类型 | npm install -D @types/node |
| Cannot use import statement outside a module | 缺少 "type": "module" | 检查 package.json 配置 |
| 构建成功但运行时失败 | 模块解析不匹配 | 确保导入使用 .js 扩展名 |

### 运行时错误

| 症状 | 可能原因 | 解决方案 |
|---|---|---|
| No API key configured | 缺少 API 密钥 | 设置 DEEPSEEK_API_KEY 或运行设置向导 |
| ECONNREFUSED | 网络/代理问题 | 检查网络，设置 SEEKCODE_BASE_URL |
| ETIMEDOUT | API 响应慢 | 增加超时或检查 API 状态 |
| 工具执行挂起 | Shell 命令卡住 | 检查命令中是否有交互式提示 |

### 开发技巧

- 使用 console.error() 输出调试信息——输出到 stderr，不会干扰工具输出解析。
- 频繁运行 npm run typecheck 尽早捕获类型错误。
- 开发时使用 --noEmit 避免不完整的构建污染 dist/。

---

## 贡献

快速检查清单：

1. Fork 仓库
2. 创建功能分支：git checkout -b feat/your-feature
3. 进行更改
4. 运行测试：npm test
5. 运行类型检查：npm run typecheck
6. 使用约定式提交信息提交：feat: add xyz
7. 推送并创建 Pull Request

---

## 许可证

MIT © Seek Code Contributors
