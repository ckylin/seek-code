# CodeGrunt — 开发者指南

> 如何从源码构建、测试和贡献 CodeGrunt。

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
git clone https://github.com/your-org/codegrunt.git
cd codegrunt
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

现在你可以在终端中任何位置运行 codegrunt。

---

## 项目结构

```
codegrunt/
├── src/
│   ├── cli/                  # CLI 入口、REPL、参数解析
│   │   ├── index.ts          # 入口（commander 驱动的 CLI）
│   │   ├── repl.ts           # 交互式 REPL 循环
│   │   ├── input.ts          # 多行输入、Tab 补全、列表选择器
│   │   ├── ink/              # Ink/React 终端 UI 组件
│   │   │   ├── PromptInput.tsx   # 主输入组件（光标、历史、补全）
│   │   │   ├── Dropdown.tsx      # 自动补全下拉菜单
│   │   │   ├── ListPicker.tsx    # 方向键列表选择器
│   │   │   ├── useAutocomplete.ts # 文件/命令/Skill 补全逻辑
│   │   │   ├── useHistory.ts     # 持久化历史记录
│   │   │   └── types.ts          # Ink 组件类型定义
│   │   ├── commands.ts       # 斜杠命令（/help, /model, /init 等）
│   │   ├── setup.ts          # 首次运行设置向导
│   │   ├── init.ts           # /init 命令实现：代码库分析 + CODEGRUNT.md 生成
│   │   ├── skills.ts         # 技能加载和管理
│   │   ├── update.ts         # 版本检查和升级
│   │   ├── banner.ts         # ASCII 艺术横幅
│   │   └── at-resolver.ts    # @文件/@URL 引用展开
│   ├── core/
│   │   ├── agent/
│   │   │   ├── loop.ts       # 代理循环 — P/G/E 编排入口
│   │   │   ├── intentor.ts   # 意图分类器（编码 vs 聊天 + Skill 匹配）
│   │   │   ├── planner.ts    # 任务规划器（分解为多步骤计划）
│   │   │   └── evaluator.ts  # 质量评估器（输出检查 + 自动修正）
│   │   ├── pipeline/         # Harness 风格管道引擎
│   │   │   ├── engine.ts     # PipelineEngine：阶段执行器
│   │   │   ├── types.ts      # 管道上下文、阶段接口、P/G/E 类型定义
│   │   │   └── stages/
│   │   │       ├── prepare-context.ts   # 构建系统提示 + 注入项目指南
│   │   │       ├── stream-response.ts   # 流式 LLM 调用 + Token 累积
│   │   │       ├── process-tools.ts     # 工具调用解析 + 执行 + 结果注入
│   │   │       ├── process-tools-helpers.ts  # yes-for-all 会话状态
│   │   │       └── post-process.ts      # 后处理：盲写警告、Token 统计
│   │   ├── tools/
│   │   │   ├── registry.ts   # 插件式 ToolRegistry（运行时注册/移除）
│   │   │   ├── executor.ts   # 工具执行（含 diff 确认、参数验证）
│   │   │   ├── read_file.ts
│   │   │   ├── write_file.ts
│   │   │   ├── edit_file.ts
│   │   │   ├── execute_shell.ts
│   │   │   ├── list_directory.ts
│   │   │   └── search_files.ts
│   │   ├── context/
│   │   │   ├── manager.ts    # 上下文窗口管理（Token 预算、裁剪）
│   │   │   └── project-guide.ts  # 加载 CODEGRUNT.md / CLAUDE.md 项目指南
│   │   ├── events/
│   │   │   └── bus.ts        # 类型化 EventBus（管道/工具/LLM 生命周期事件）
│   │   ├── observability/
│   │   │   ├── logger.ts     # Logger v2：文件传输 + Trace ID + 日志轮转
│   │   │   └── metrics.ts    # 轻量 Metrics（计数器、计时器、快照）
│   │   └── di/
│   │       └── container.ts  # 服务容器/DI（单例、瞬态、生命周期管理）
│   ├── providers/
│   │   └── deepseek/
│   │       ├── provider.ts   # DeepSeek LLM 提供商实现
│   │       └── client.ts     # OpenAI 兼容客户端工厂 + API Key 验证
│   ├── utils/
│   │   ├── display.ts        # 终端输出格式化（计划、步骤、评估）
│   │   ├── confirm.ts        # Diff 预览和用户确认
│   │   ├── billing.ts        # 余额/用量查询和费用展示
│   │   ├── markdown.ts       # 流式 Markdown 转终端渲染器
│   │   ├── interrupt.ts      # SIGINT 处理
│   │   ├── select.ts         # 交互式列表选择器（方向键导航）
│   │   └── constants.ts      # 共享常量
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
├── CODEGRUNT.md               # CodeGrunt 项目指南
├── CLAUDE.md                 # AI 编码助手项目指南
└── README.md
```

---

## 构建系统

### 编译

CodeGrunt 使用标准 TypeScript 编译器（tsc）进行生产构建。

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
- jsx: react-jsx — 为 React/Ink 组件提供 JSX 支持（jsxImportSource: react）

关键点：

- **仅 ESM**：项目在 package.json 中使用 "type": "module"。所有导入使用 .js 扩展名约定（例如 import { foo } from './bar.js'）。
- **bundler 解析**：兼容 tsx（开发）和 tsc（生产）。
- **declaration: true**：为使用者生成 .d.ts 类型声明文件。
- **JSX for Ink**：`src/cli/ink/` 目录包含通过 `ink` 库在终端渲染的 React 组件。TSX 文件使用 `react-jsx` 转换。

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
    expect(result.output).toContain('"name": "codegrunt"');
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
  ┌──────────────┐
  │   Intentor   │  意图分类：Skill 匹配 / 编码 → P/G/E / 聊天 → 直接生成
  └──────┬───────┘
         │
    ┌────▼─────────────────────────────────────┐
    │  Planner → Generator → Evaluator          │
    │   规划        执行       质量评估           │
    │        (评估不通过自动修正重试，最多 3 次)    │
    └──────────────────────────────────────────┘
         │
    ┌────▼──────────┐
    │  管道引擎       │  5 个阶段：准备→流式→工具→后处理
    │  (Pipeline)    │
    └───────────────┘
         │
    ┌────▼────┐
    │  工具    │  6 个内置工具 + 插件式注册表
    │ (6+)    │
    └─────────┘
```

### 代理循环（src/core/agent/loop.ts）

代理循环是 CodeGrunt 的核心，采用 **P/G/E（Planner / Generator / Evaluator）+ Intentor** 架构：

**Phase 0 — Intentor（意图分类）**：将任务分为三条路径：
- **Skill 匹配** → `runSkillFlow`：应用 Skill 系统提示 + 内容，然后按聊天方式生成
- **编码任务** → `runCodingFlow`：P/G/E 管道：规划 → 执行 → 评估 → 修正
- **聊天任务** → `runChatFlow`：直接生成管道，跳过 Planner/Evaluator

Intentor 优先使用快速启发式规则：
- **关键词模式**：编码信号（写/创建/修复/重构）vs 非编码（解释/什么是/总结）
- **Continuation 检测**：短命令式短语如「继续」「go on」「next」默认走编码路径
- **Skill 匹配**：任务与 Skill 名称/描述的关键词重叠（≥40% 匹配度）

仅在启发式规则不明确时才调用 LLM，节省延迟和费用。

**编码流程 — P/G/E 管道**：
1. **Planner（规划器）**：将复杂任务分解为 2-5 个独立可验证的步骤，使用低温（0.1）结构化 JSON 输出。短任务（≤50 字符）和 continuation 信号跳过 Planner
2. **Generator（生成器）**：管道引擎依次执行每个步骤 → 准备上下文 → 流式 LLM 调用 → 工具执行 → 后处理。现支持**步骤内多轮迭代**——单个步骤内可进行多次工具调用往返
3. **Evaluator（评估器）**：检查输出质量 / 计划符合度 / 幻觉。不通过则注入反馈并重试（最多 3 次，由原来的 2 次提升）。`pruneRefineMessages()` 在步骤间清理评估反馈消息
4. `sessionHasRead` 追踪跨步骤的文件读取，避免重复操作

**聊天流程**：跳过 Planner/Evaluator，直接用 Generator 管道迭代到模型停止（最多 30 次）。模型返回空时显示回退文本「（模型未返回文本响应）」。

**Skill 流程**：应用 Skill 系统提示 + 内容，然后按聊天模式进行工具调用迭代。

关键设计决策：

- **系统提示稳定性**：系统提示只构建一次，会话期间不更改。最大化 DeepSeek 提示缓存命中率。
- **管道架构**：借鉴 Harness CI/CD，5 个独立可测试阶段共享 `PipelineContext`
- **EventBus**：所有生命周期事件（管道启动/完成、工具调用、LLM 用量）通过类型化 EventBus 发布
- **DI 容器**：服务通过 `ServiceContainer` 注册/解析，支持单例和瞬态生命周期
- **流式优先**：所有 LLM 通信通过 `AsyncIterable<StreamChunk>` 流式传输，实时终端输出

### 工具系统

工具是 LLM 与用户环境交互的机制。每个工具实现 `Tool` 接口，通过插件式 `ToolRegistry` 注册（支持运行时动态添加/移除）。

六个内置工具：

| 工具 | 描述 |
|---|---|
| read_file | 读取文件内容（截断至 30,000 字符） |
| write_file | 写入内容到文件（自动创建目录） |
| edit_file | 替换文件中的精确字符串 |
| execute_shell | 运行 shell 命令（带超时） |
| list_directory | 列出目录树（可配置深度） |
| search_files | 在文件中搜索文本模式 |

**安全性**：在破坏性操作（write_file、edit_file、execute_shell）之前，执行器会显示 diff 预览并请求用户确认，提供三个选项：是、本次会话全部允许、否。

### 管道引擎（src/core/pipeline/）

借鉴 Harness CI/CD 管道架构，将每次 Agent 交互分解为 5 个独立阶段：

| 阶段 | 文件 | 职责 |
|---|---|---|
| PrepareContext | `prepare-context.ts` | 构建系统提示、注入项目指南、初始化消息 |
| StreamResponse | `stream-response.ts` | 流式调用 LLM、累积文本/推理/工具调用 |
| ProcessToolCalls | `process-tools.ts` | 解析工具调用、通过 executor 执行、注入结果 |
| ProcessToolHelpers | `process-tools-helpers.ts` | yes-for-all 会话级状态管理 |
| PostProcess | `post-process.ts` | 盲写警告检测、Token 统计、最终输出格式化 |

所有阶段共享一个 `PipelineContext`，由 `PipelineEngine` 按序执行。

### 上下文管理（src/core/context/manager.ts）

ContextManager 维护对话历史：

- **Token 估算**：使用简单的 4:1 字符与 Token 比率。
- **裁剪**：当估算的 Token 数超过预算时，移除最旧的非系统消息。
- **预算**：聊天模型默认 90,000 Token（128K 上下文窗口减去输出空间）；推理模型 100,000 Token（1M 上下文窗口）。

### 提供商系统

所有 LLM 后端实现 LLMProvider 接口。StreamChunk 联合类型支持：

- text_delta — 增量文本输出
- reasoning_delta — 思维链推理（显示为 Thinking...）
- tool_call_delta — 流式工具调用参数
- finish — 流结束，包含结束原因

### 可观测性

- **Logger v2**（`observability/logger.ts`）：结构化分级日志，支持命名空间。功能包括：
  - **文件传输**：结构化 JSONL 日志写入 `~/.codegrunt/logs/`
  - **Trace ID**：唯一 `runId` 用于跨会话关联。通过 `createLogger('namespace', runId)` 创建
  - **日志轮转**：保留最近 5 个日志文件，每个最大 5 MB
  - **环境变量控制**：`CODEGRUNT_LOG_LEVEL`（debug/info/warn/error）、`CODEGRUNT_LOG_FILE`（设为 0/false 禁用）、`CODEGRUNT_VERBOSE`
  - 错误自动发布到 EventBus
- **Metrics**（`observability/metrics.ts`）：计数器/计时器/快照，支持遥测摘要输出
- **EventBus**（`events/bus.ts`）：类型化事件总线，覆盖管道、工具、LLM、对话等全部生命周期事件

### Ink/React 终端 UI（`src/cli/ink/`）

CodeGrunt 提供基于 React 的现代终端 UI，使用 `ink` 库构建：

| 组件 | 描述 |
|---|---|
| `PromptInput.tsx` | 主输入组件：光标移动、上下键历史导航、自动补全下拉、Ctrl+C 取消 |
| `Dropdown.tsx` | 自动补全浮层：`❯` 指示器、skill/builtin/file 分类着色、最多 8 项可见 |
| `ListPicker.tsx` | 方向键选择器，用于模型/配置的交互式选择 |
| `useAutocomplete.ts` | 文件路径（`@`）补全、斜杠命令补全、Skill 名称补全 |
| `useHistory.ts` | 持久化命令历史，方向键导航 |

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

添加到 src/core/tools/registry.ts 的 `ToolRegistry.registerBuiltins()` 方法中：

```typescript
import { myTool } from './my_tool.js';
// 在 registerBuiltins() 数组中添加 myTool,
```

### 步骤 3：添加安全确认（如果是破坏性操作）

在 src/core/tools/executor.ts 的 `executeTool()` 中添加确认逻辑（参考 edit_file/write_file 的处理方式）。

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

CodeGrunt 在交互式 REPL 中提供了一组斜杠命令，实现在 `src/cli/commands.ts` 中。

| 命令 | 描述 |
|---|---|
| `/help` | 显示可用命令和当前配置 |
| `/model <名称>` | 切换活跃的 LLM 模型（无参数时交互式选择） |
| `/init` | 分析代码库并生成 CODEGRUNT.md 项目指南 |
| `/clear` | 清除对话历史 |
| `/compact` | 总结并压缩对话历史以节省 Token |
| `/review` | 审查会话变更中的逻辑问题 |
| `/cost` | 显示当前会话的 Token 使用量和预估费用 |
| `/balance` | 显示账户余额和用量（今日 / 本月） |
| `/config` | 显示或更改配置设置 |
| `/reasoning` / `/effort` | 设置 R1 模型的推理强度（low/medium/high） |
| `/skills` | 列出和管理技能（创建、列表） |
| `/exit` | 退出 REPL |

---

## @-引用语法

CodeGrunt 在 REPL 和单次任务模式中支持 `@`-引用，实现在 `src/cli/at-resolver.ts`。这让你可以直接在提示中引用文件和 URL。

### 文件引用

```bash
# 引用文件——文件内容会被内联到提示中
codegrunt "解释 @src/core/agent/loop.ts"

# 引用多个文件
codegrunt "比较 @src/config.ts 和 @src/types.ts"
```

### URL 引用

```bash
# 引用 URL——内容会被获取并内联
codegrunt "总结 @https://example.com/docs/api"
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

当首次启动 CodeGrunt 且未配置 API 密钥时，会运行设置向导（`src/cli/setup.ts`）。

### 功能

1. **检测缺少配置** — 检查是否设置了 `DEEPSEEK_API_KEY` 或存在 `~/.codegrunt/config.json`
2. **提示输入 API 密钥** — 要求用户输入 DeepSeek API 密钥
3. **模型选择** — 让用户从可用的 DeepSeek 模型中选择
4. **保存配置** — 写入 `~/.codegrunt/config.json`
5. **验证密钥** — 进行测试 API 调用以确认密钥有效

### 跳过向导

可以通过预先配置来跳过向导：

```bash
export DEEPSEEK_API_KEY=sk-xxxxxxxx
# 或手动创建 ~/.codegrunt/config.json
```

---

## 项目指南系统

CodeGrunt 会自动加载项目根目录中的 `CODEGRUNT.md` 或 `CLAUDE.md` 文件作为项目级指导，实现在 `src/core/context/project-guide.ts`。

### 工作原理

1. 启动时，CodeGrunt 在当前工作目录查找 `CODEGRUNT.md` 或 `CLAUDE.md`
2. 如果找到，文件内容会被前置到系统提示中
3. 这样每个项目都可以为 AI 助手定义自定义指令

### 示例 `CODEGRUNT.md`

```markdown
# CODEGRUNT.md

该文件为 CodeGrunt 在此项目中工作时提供指导。

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

如果 `CODEGRUNT.md` 和 `CLAUDE.md` 同时存在，`CODEGRUNT.md` 优先加载。两个文件都支持 Markdown 格式。

---

## 配置系统

CodeGrunt 的配置加载链（优先级从高到低）：

1. 环境变量（如 `CODEGRUNT_MODEL`）
2. `~/.codegrunt/config.json` 配置文件
3. 硬编码默认值（`src/config.ts` 中的 `DEFAULTS`）

### 关键配置项

| 配置项 | 环境变量 | 默认值 |
|---|---|---|
| API Key | `DEEPSEEK_API_KEY` | — |
| 模型 | `CODEGRUNT_MODEL` | `deepseek-v4-pro` |
| 最大 Token | `CODEGRUNT_MAX_TOKENS` | `8192` |
| 温度 | `CODEGRUNT_TEMPERATURE` | `0.2` |
| 推理强度 | `CODEGRUNT_REASONING_EFFORT` | `medium` |
| Top-P | `CODEGRUNT_TOP_P` | `1` |
| 频率惩罚 | `CODEGRUNT_FREQUENCY_PENALTY` | `0` |
| 存在惩罚 | `CODEGRUNT_PRESENCE_PENALTY` | `0` |
| Base URL | `CODEGRUNT_BASE_URL` | `https://api.deepseek.com` |
| 日志级别 | `CODEGRUNT_LOG_LEVEL` | `info` |
| 文件日志 | `CODEGRUNT_LOG_FILE` | 启用 |
| 详细输出 | `CODEGRUNT_VERBOSE` | 禁用 |

### 模型判断逻辑（`src/config.ts`）

- `isReasonerModel(model)`：检测是否为 R1 推理模型（ID 包含 `reasoner` 或 `r1`）
- `supportsReasoning(model)`：检测是否支持 reasoning_content（R1 模型 + V4 Pro 模型）
- 推理模型：使用更大的上下文预算（`CONTEXT_BUDGET = 100_000`），不支持 temperature 参数
- 聊天模型：使用标准预算（`CHAT_CONTEXT_BUDGET = 90_000`），支持全部参数

---

## 发布流程

1. 更新 `package.json` 中的版本号
2. 运行 `npm run build` 确保编译通过
3. 运行 `npm test` 确保测试通过
4. 提交变更并打 tag：`git tag v<version>`
5. 发布：`npm publish`

---

## 常见问题排查

| 问题 | 可能原因 | 解决方法 |
|---|---|---|
| `Error: No API key configured` | 未设置 `DEEPSEEK_API_KEY` | 运行 `codegrunt` 启动设置向导，或手动 `export DEEPSEEK_API_KEY=sk-...` |
| 构建失败 | Node.js 版本过低 | 确保使用 Node.js 18+ |
| 类型错误 | `node_modules` 过期 | 运行 `npm install` 重新安装依赖 |
| `MODULE_NOT_FOUND` | 导入路径缺少 `.js` 扩展名 | ESM 要求导入使用 `.js` 后缀（TypeScript 约定） |
| 工具调用无响应 | API 配额耗尽 | 检查 `/balance` 命令输出 |
| `src/cli/ink/` 中 JSX 编译错误 | 缺少 React 类型 | 运行 `npm install` 确保安装了 `@types/react` |
