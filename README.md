# CodeGrunt <small>（代码民工）</small>

<p align="center">
  <img src="./assets/logo.png" alt="CodeGrunt Logo" width="50%" />
</p>

> **代码民工** — 终端原生的 AI 命令行编程助手，基于 DeepSeek 构建。

[![npm version](https://img.shields.io/npm/v/codegrunt.svg)](https://www.npmjs.com/package/codegrunt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

CodeGrunt 是一个开源的终端原生 AI 编程助手。它能读懂你的代码库、理解上下文，帮助你在命令行中编写、重构、调试和交付代码。

```bash
# 交互式 REPL
codegrunt

# 单次任务
codegrunt "把 auth 模块重构为 async/await"
```

---

## 特性

- **🤖 P/G/E 智能代理** — 使用 Intentor → Planner → Generator → Evaluator 四阶段架构：意图分类（含 Skill 自动匹配）→ 任务分解 → 管道执行（支持步骤内多轮工具调用）→ 质量评估与自动修正（最多 3 次），确保输出质量
- **📂 理解代码库** — 通过 `@` 文件引用和项目指南文件（`CODEGRUNT.md` / `CLAUDE.md`）理解你的项目结构、模块导入和编码约定
- **🔌 DeepSeek 驱动** — 内置支持 DeepSeek Chat、V4 Flash、V4 Pro 和 R1 推理模型
- **🛠️ 工具调用** — 6 个内置工具（插件式注册表，支持运行时增删）：文件读写/编辑、Shell 执行、目录列表、代码搜索，破坏性操作会显示 diff 预览并请求用户确认
- **⚡ 流式输出** — 实时 Token 流式传输，支持 Markdown 渲染和推理过程可见，终端体验流畅
- **📎 @-引用** — 使用 `@file.ts`、`@src/` 或 `@https://example.com` 将文件内容、目录列表或网页内容直接注入提示词
- **🎯 斜杠命令** — `/init` 自动生成项目指南、`/model` 切换模型、`/compact` 压缩对话历史、`/review` 审查变更、`/skills` 管理技能等
- **🔒 默认安全** — 破坏性操作（写入/编辑/Shell）显示 diff 预览并要求用户确认后执行，支持「本次会话全部允许」
- **🔧 技能系统** — 从 `.zip` 文件安装可复用的提示词模板，Intentor 自动按关键词匹配合适的 Skill，也可作为斜杠命令运行
- **💲 费用追踪** — 使用 `/cost` 和 `/balance` 命令实时查看会话 Token 用量和费用
- **🎨 现代终端 UI** — 基于 Ink/React 的终端输入组件，支持方向键导航、历史记录、自动补全下拉菜单
- **📋 结构化日志** — Logger v2 支持 JSONL 文件日志（`~/.codegrunt/logs/`）、Trace ID 跨会话关联、日志自动轮转（5 文件、每文件 5MB）

---

## 快速开始

```bash
# 全局安装
npm install -g codegrunt

# 设置 API 密钥
export DEEPSEEK_API_KEY=your_key_here

# 启动交互式会话
codegrunt

# 单次任务
codegrunt "解释这个项目的架构"
```

首次运行且未配置 API 密钥时，CodeGrunt 会启动交互式设置向导引导你完成配置。

---

## 安装

**环境要求：** Node.js 18+

### npm（推荐）

```bash
npm install -g codegrunt
```

### pnpm

```bash
pnpm add -g codegrunt
```

### 从源码构建

```bash
git clone https://github.com/your-org/codegrunt.git
cd codegrunt
npm install
npm run build
npm link
```

---

## 使用方法

### 交互式 REPL

```bash
codegrunt
```

启动交互式会话，提供：

- 显示当前模型的 ASCII 艺术横幅
- `>` 提示符用于输入任务
- 文件路径（`@`）和斜杠命令（`/`）的 Tab 补全
- 多行输入支持
- 方向键历史记录导航
- 基于 Ink/React 的现代终端输入界面

### 单次任务模式

```bash
codegrunt "你的任务描述"
```

执行单个任务后退出。适用于脚本编写和快速查询。

### 斜杠命令

| 命令 | 描述 |
|---|---|
| `/help` | 显示帮助信息和所有可用命令 |
| `/model` | 交互式切换模型（方向键选择器） |
| `/model <id>` | 切换到指定模型（例如 `/model deepseek-v4-pro`） |
| `/init` | 分析代码库并生成 `CODEGRUNT.md` 项目指南 |
| `/clear` | 清除对话上下文 |
| `/compact` | 总结并压缩对话历史以节省 Token |
| `/review` | 审查本次会话的变更是否有逻辑问题 |
| `/cost` | 显示会话 Token 使用量和预估费用 |
| `/balance` | 显示账户余额和用量（今日 / 本月） |
| `/config` | 显示或修改配置设置 |
| `/reasoning` / `/effort` | 设置 R1 模型的推理强度（low/medium/high） |
| `/token` | 更新 DeepSeek API 密钥 |
| `/skills` | 列出和管理技能（创建、列表） |
| `/exit` | 退出 CodeGrunt |

### @-引用

在提示词中直接引用文件、目录或 URL：

| 语法 | 描述 | 示例 |
|---|---|---|
| `@<文件>` | 注入文件内容 | `@src/index.ts` |
| `@<目录>` | 注入目录列表（最多 20 条） | `@src/components/` |
| `@<网址>` | 获取并注入网页内容 | `@https://example.com` |

支持文件和目录路径的 Tab 补全。

---

## 配置

CodeGrunt 通过环境变量或 `~/.codegrunt/config.json` 文件配置。

### 环境变量

| 变量 | 描述 | 默认值 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | — |
| `CODEGRUNT_MODEL` | 使用的模型 ID | `deepseek-v4-pro` |
| `CODEGRUNT_PROVIDER` | LLM 提供商 | `deepseek` |
| `CODEGRUNT_MAX_TOKENS` | 每次响应的最大 Token 数 | `8192` |
| `CODEGRUNT_TEMPERATURE` | 响应温度 (0-2) | `0.2` |
| `CODEGRUNT_BASE_URL` | 自定义 API 基础 URL | `https://api.deepseek.com` |
| `CODEGRUNT_REASONING_EFFORT` | R1 推理强度：`low` \| `medium` \| `high` | `medium` |
| `CODEGRUNT_TOP_P` | 核采样 (0-1) | `1` |
| `CODEGRUNT_FREQUENCY_PENALTY` | 重复惩罚 (-2 到 2) | `0` |
| `CODEGRUNT_PRESENCE_PENALTY` | 主题多样性惩罚 (-2 到 2) | `0` |
| `CODEGRUNT_LOG_LEVEL` | 日志级别：`debug` \| `info` \| `warn` \| `error` | `info` |
| `CODEGRUNT_LOG_FILE` | 设为 `0` 或 `false` 禁用文件日志 | 启用 |
| `CODEGRUNT_VERBOSE` | 启用详细 stderr 输出 | 禁用 |

### 配置文件 (`~/.codegrunt/config.json`)

```json
{
  "apiKey": "sk-xxxxxxxx",
  "model": "deepseek-v4-pro",
  "maxTokens": 8192,
  "temperature": 0.2,
  "reasoningEffort": "medium",
  "topP": 1,
  "frequencyPenalty": 0,
  "presencePenalty": 0
}
```

配置文件在首次运行时通过设置向导自动生成。环境变量优先级高于配置文件。

---

## 支持的模型

| 提供商 | 模型 | 状态 |
|---|---|---|
| [DeepSeek](https://platform.deepseek.com/) | `deepseek-chat`、`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-reasoner` | ✅ 支持 |

---

## 架构

```
codegrunt/
├── src/
│   ├── cli/                      # CLI 入口、REPL、参数解析
│   │   ├── index.ts              # 入口（commander 驱动）
│   │   ├── repl.ts               # 交互式 REPL 循环
│   │   ├── input.ts              # 多行输入、Tab 补全、列表选择器
│   │   ├── ink/                  # Ink/React 终端 UI 组件
│   │   │   ├── PromptInput.tsx   # 主输入组件（光标、历史、补全）
│   │   │   ├── Dropdown.tsx      # 自动补全下拉菜单
│   │   │   ├── ListPicker.tsx    # 方向键列表选择器
│   │   │   ├── useAutocomplete.ts # 文件/命令/Skill 补全逻辑
│   │   │   ├── useHistory.ts     # 持久化历史记录
│   │   │   └── types.ts          # Ink 组件类型定义
│   │   ├── commands.ts           # 斜杠命令（/help, /model, /init 等）
│   │   ├── setup.ts              # 首次运行设置向导
│   │   ├── skills.ts             # 技能加载和管理
│   │   ├── update.ts             # 版本检查和升级
│   │   ├── banner.ts             # ASCII 艺术横幅
│   │   └── at-resolver.ts        # @文件/@URL 引用展开
│   ├── core/
│   │   ├── agent/
│   │   │   ├── loop.ts           # 代理循环 — P/G/E 编排入口
│   │   │   ├── intentor.ts       # 意图分类器（编码/聊天/Skill 匹配）
│   │   │   ├── planner.ts        # 任务规划器（分解为多步骤计划）
│   │   │   └── evaluator.ts      # 质量评估器（输出检查 + 自动修正）
│   │   ├── pipeline/             # Harness 风格管道引擎
│   │   │   ├── engine.ts         # PipelineEngine：阶段执行器
│   │   │   ├── types.ts          # 管道上下文、阶段接口、P/G/E 类型
│   │   │   └── stages/
│   │   │       ├── prepare-context.ts   # 构建系统提示 + 注入项目指南
│   │   │       ├── stream-response.ts   # 流式 LLM 调用 + Token 累积
│   │   │       ├── process-tools.ts     # 工具调用解析 + 执行 + 结果注入
│   │   │       ├── process-tools-helpers.ts  # yes-for-all 会话状态
│   │   │       └── post-process.ts      # 后处理：盲写警告、Token 统计
│   │   ├── tools/
│   │   │   ├── registry.ts       # 插件式 ToolRegistry（运行时注册/移除）
│   │   │   ├── executor.ts       # 工具执行（含 diff 确认、参数验证）
│   │   │   ├── read_file.ts
│   │   │   ├── write_file.ts
│   │   │   ├── edit_file.ts
│   │   │   ├── execute_shell.ts
│   │   │   ├── list_directory.ts
│   │   │   └── search_files.ts
│   │   ├── context/
│   │   │   ├── manager.ts        # 上下文窗口管理（Token 预算、裁剪）
│   │   │   └── project-guide.ts  # 加载 CODEGRUNT.md / CLAUDE.md 项目指南
│   │   ├── events/
│   │   │   └── bus.ts            # 类型化 EventBus（管道/工具/LLM 生命周期事件）
│   │   ├── observability/
│   │   │   ├── logger.ts         # Logger v2：文件日志 + Trace ID + 日志轮转
│   │   │   └── metrics.ts        # 轻量 Metrics（计数器、计时器、快照）
│   │   └── di/
│   │       └── container.ts      # 服务容器/DI（单例、瞬态、生命周期管理）
│   ├── providers/
│   │   └── deepseek/
│   │       ├── provider.ts       # DeepSeek LLM 提供商实现
│   │       └── client.ts         # OpenAI 兼容客户端工厂 + API Key 验证
│   ├── utils/
│   │   ├── display.ts            # 终端输出格式化（计划、步骤、评估）
│   │   ├── confirm.ts            # Diff 预览和用户确认
│   │   ├── billing.ts            # 余额/用量查询和费用展示
│   │   ├── markdown.ts           # 流式 Markdown 转终端渲染器
│   │   ├── interrupt.ts          # SIGINT 处理
│   │   ├── select.ts             # 交互式列表选择器（方向键导航）
│   │   └── constants.ts          # 共享常量
│   ├── config.ts                 # 配置加载（环境变量、配置文件）
│   └── types.ts                  # 共享 TypeScript 类型和接口
├── tests/
│   ├── tools/
│   │   ├── read_file.test.ts
│   │   ├── write_file.test.ts
│   │   └── execute_shell.test.ts
├── docs/
│   ├── development-guide.md      # 开发指南（英文）
│   ├── development-guide.zh-CN.md # 开发者指南（中文）
│   └── VERSION.md                # 发版流程指南
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CODEGRUNT.md                   # CodeGrunt 项目指南
├── CLAUDE.md                     # AI 编码助手项目指南
└── README.md                     # 本文件
```

### 整体流程

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
    │     (评估不通过自动修正重试，最多 3 次)       │
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

### 代理循环 (`src/core/agent/loop.ts`)

代理循环是 CodeGrunt 的核心，采用 **P/G/E（Planner / Generator / Evaluator）+ Intentor** 架构：

**Phase 0 — Intentor（意图分类）**：将任务分为三类路径 — Skill 匹配、编码、聊天。优先使用快速启发式规则（关键词模式、continuation 检测、Skill 关键词重叠 ≥40%），仅在结果模糊时调用 LLM。

**编码流程 — P/G/E 管道**：
1. **Planner（规划器）**：将复杂任务分解为 2-5 个独立可验证的步骤。短任务（≤50 字符）和 continuation 信号会跳过 Planner
2. **Generator（生成器）**：管道引擎依次执行每个步骤 — 支持**步骤内多轮迭代**（单步骤可进行多次工具调用往返）
3. **Evaluator（评估器）**：质量检查 / 计划符合度 / 幻觉检测。不通过则注入反馈并重试（最多 3 次）。`pruneRefineMessages` 在步骤间清理评估反馈消息
4. `sessionHasRead` 追踪跨步骤的文件读取，避免重复操作

**Skill 流程**：应用 Skill 系统提示 + 内容，然后按聊天模式进行工具调用迭代生成。

**聊天流程**：跳过 Planner/Evaluator，直接用 Generator 管道迭代到模型停止（最多 30 次），模型返回空时显示回退文本。

关键设计决策：

- **系统提示稳定性**：系统提示只构建一次，会话期间不更改。最大化 DeepSeek 提示缓存命中率。
- **管道架构**：借鉴 Harness CI/CD，5 个独立可测试阶段共享 `PipelineContext`
- **EventBus**：所有生命周期事件（管道启动/完成、工具调用、LLM 用量）通过类型化 EventBus 发布
- **DI 容器**：服务通过 `ServiceContainer` 注册/解析，支持单例和瞬态生命周期
- **流式优先**：所有 LLM 通信通过 `AsyncIterable<StreamChunk>` 流式传输，实时终端输出

### 工具系统

工具是 LLM 与用户环境交互的方式。每个工具实现 `Tool` 接口，通过插件式 `ToolRegistry` 注册（支持运行时动态添加/移除）。

| 工具 | 描述 |
|---|---|
| `read_file` | 读取文件内容（截断至 30,000 字符） |
| `write_file` | 写入内容到文件（自动创建目录） |
| `edit_file` | 替换文件中的精确字符串 |
| `execute_shell` | 运行 Shell 命令（带超时） |
| `list_directory` | 列出目录树（可配置深度） |
| `search_files` | 在文件中搜索文本模式 |

**安全机制**：在执行破坏性操作之前，执行器会显示 diff 预览并请求用户确认，提供三个选项：是、本次会话全部允许、否。

### 上下文管理 (`src/core/context/manager.ts`)

`ContextManager` 维护对话历史：

- **Token 估算**：使用简单的 4:1 字符与 Token 比率
- **裁剪**：当估算 Token 数超过预算时，移除最旧的非系统消息
- **预算**：聊天模型默认 90,000 Token，推理模型 100,000 Token

### 可观测性

- **Logger v2** (`observability/logger.ts`)：结构化 JSONL 文件日志（`~/.codegrunt/logs/`）、Trace ID 跨会话关联、日志轮转（5 文件、5MB）、环境变量控制
- **Metrics** (`observability/metrics.ts`)：计数器/计时器/快照，遥测摘要输出
- **EventBus** (`events/bus.ts`)：类型化事件总线，覆盖全部生命周期事件

### 提供商系统

DeepSeek 提供商实现 `LLMProvider` 接口。`StreamChunk` 判别联合类型支持：

- `text_delta` — 增量文本输出
- `reasoning_delta` — 思维链推理（显示为 "Thinking..."）
- `tool_call_delta` — 流式工具调用参数
- `finish` — 流结束，包含结束原因

---

## 开发

### 命令

```bash
npm run dev        # 开发模式，热重载 (tsx)
npm run build      # 编译 TypeScript 到 dist/
npm run typecheck  # 仅类型检查，不输出文件
npm test           # 运行 vitest 测试套件
npm start          # 运行编译后的 dist/cli/index.js

# 运行单个测试文件
npx vitest run tests/tools/read_file.test.ts
```

### 项目结构

- `src/cli/` — 入口、REPL 循环、参数解析、技能、更新、**Ink/React 终端 UI**
- `src/core/agent/` — Intentor（意图+Skill 分类）、Planner（任务分解）、Generator（管道执行）、Evaluator（质量评估）
- `src/core/pipeline/` — Harness 风格管道引擎（5 阶段）
- `src/core/tools/` — 文件读写、Shell 执行、搜索工具实现
- `src/core/context/` — 上下文窗口管理和项目指南加载
- `src/core/events/` — 类型化 EventBus
- `src/core/observability/` — Logger v2 + Metrics
- `src/core/di/` — 服务容器/DI
- `src/providers/` — LLM 提供商适配器，实现共享的 `LLMProvider` 接口
- `src/utils/` — 共享工具（显示、确认、计费、Markdown、中断、选择器）

详细开发说明请参阅：
- [开发指南（英文）](docs/development-guide.md)
- [开发者指南（中文）](docs/development-guide.zh-CN.md)

---

## 许可证

MIT
