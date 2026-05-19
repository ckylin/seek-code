# Seek Code

<p align="center">
  <img src="./assets/logo.png" alt="Seek Code Logo" width="50%" />
</p>

> 终端原生的 AI 命令行编程助手 — 基于 DeepSeek 构建。

[![npm version](https://img.shields.io/npm/v/seekcode.svg)](https://www.npmjs.com/package/seekcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

Seek Code 是一个开源的终端原生 AI 编程助手。它能读懂你的代码库、理解上下文，帮助你在命令行中编写、重构、调试和交付代码。

```bash
# 交互式 REPL
seekcode

# 单次任务
seekcode "把 auth 模块重构为 async/await"
```

---

## 特性

- **🤖 智能代理** — 使用 ReAct（推理 + 行动）循环，自主执行多步骤任务：读取文件、编辑代码、运行 Shell、搜索代码库
- **📂 理解代码库** — 通过 `@` 文件引用和项目指南文件（`SEEKCODE.md` / `CLAUDE.md`）理解你的项目结构、模块导入和编码约定
- **🔌 DeepSeek 驱动** — 内置支持 DeepSeek Chat、V4 Flash、V4 Pro 和 R1 推理模型
- **🛠️ 工具调用** — 6 个内置工具：文件读写/编辑、Shell 执行、目录列表、代码搜索，破坏性操作会显示 diff 预览并请求用户确认
- **⚡ 流式输出** — 实时 Token 流式传输，支持 Markdown 渲染和推理过程可见，终端体验流畅
- **📎 @-引用** — 使用 `@file.ts`、`@src/` 或 `@https://example.com` 将文件内容、目录列表或网页内容直接注入提示词
- **🎯 斜杠命令** — `/init` 自动生成项目指南、`/model` 切换模型、`/compact` 压缩对话历史、`/review` 审查变更、`/skills` 管理技能等
- **🔒 默认安全** — 破坏性操作（写入/编辑/Shell）显示 diff 预览并要求用户确认后执行
- **🔧 技能系统** — 从 `.zip` 文件安装可复用的提示词模板，作为斜杠命令运行
- **💲 费用追踪** — 使用 `/cost` 和 `/balance` 命令实时查看会话 Token 用量和费用

---

## 快速开始

```bash
# 全局安装
npm install -g seekcode

# 设置 API 密钥
export DEEPSEEK_API_KEY=your_key_here

# 启动交互式会话
seekcode

# 单次任务
seekcode "解释这个项目的架构"
```

首次运行且未配置 API 密钥时，Seek Code 会启动交互式设置向导引导你完成配置。

---

## 安装

**环境要求：** Node.js 18+

### npm（推荐）

```bash
npm install -g seekcode
```

### pnpm

```bash
pnpm add -g seekcode
```

### 从源码构建

```bash
git clone https://github.com/your-org/seekcode.git
cd seekcode
npm install
npm run build
npm link
```

---

## 使用方法

### 交互式 REPL

```bash
seekcode
```

启动交互式会话，提供：

- 显示当前模型的 ASCII 艺术横幅
- `>` 提示符用于输入任务
- 文件路径（`@`）和斜杠命令（`/`）的 Tab 补全
- 多行输入支持
- 方向键历史记录导航

### 单次任务模式

```bash
seekcode "你的任务描述"
```

执行单个任务后退出。适用于脚本编写和快速查询。

### 斜杠命令

| 命令 | 描述 |
|---|---|
| `/help` | 显示帮助信息和所有可用命令 |
| `/model` | 交互式切换模型（方向键选择器） |
| `/model <id>` | 切换到指定模型（例如 `/model deepseek-v4-pro`） |
| `/init` | 分析代码库并生成 `SEEKCODE.md` 项目指南 |
| `/clear` | 清除对话上下文 |
| `/compact` | 总结并压缩对话历史以节省 Token |
| `/review` | 审查本次会话的变更是否有逻辑问题 |
| `/cost` | 显示会话 Token 使用量和预估费用 |
| `/balance` | 显示账户余额和用量（今日 / 本月） |
| `/config` | 显示或修改配置设置 |
| `/reasoning` / `/effort` | 设置 R1 模型的推理强度（low/medium/high） |
| `/token` | 更新 DeepSeek API 密钥 |
| `/skills` | 列出和管理技能（创建、列表） |
| `/exit` | 退出 Seek Code |

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

Seek Code 通过环境变量或 `~/.seekcode/config.json` 文件配置。

### 环境变量

| 变量 | 描述 | 默认值 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | — |
| `SEEKCODE_MODEL` | 使用的模型 ID | `deepseek-v4-pro` |
| `SEEKCODE_PROVIDER` | LLM 提供商 | `deepseek` |
| `SEEKCODE_MAX_TOKENS` | 每次响应的最大 Token 数 | `8192` |
| `SEEKCODE_TEMPERATURE` | 响应温度 (0-2) | `0.2` |
| `SEEKCODE_BASE_URL` | 自定义 API 基础 URL | `https://api.deepseek.com` |
| `SEEKCODE_REASONING_EFFORT` | R1 推理强度：`low` \| `medium` \| `high` | `medium` |
| `SEEKCODE_TOP_P` | 核采样 (0-1) | `1` |
| `SEEKCODE_FREQUENCY_PENALTY` | 重复惩罚 (-2 到 2) | `0` |
| `SEEKCODE_PRESENCE_PENALTY` | 主题多样性惩罚 (-2 到 2) | `0` |

### 配置文件 (`~/.seekcode/config.json`)

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
seekcode/
├── src/
│   ├── cli/                      # CLI 入口、REPL、参数解析
│   │   ├── index.ts              # 入口（commander 驱动）
│   │   ├── repl.ts               # 交互式 REPL 循环
│   │   ├── input.ts              # 多行输入、Tab 补全、列表选择器
│   │   ├── commands.ts           # 斜杠命令（/help, /model, /init 等）
│   │   ├── setup.ts              # 首次运行设置向导
│   │   ├── skills.ts             # 技能加载和管理
│   │   ├── update.ts             # 版本检查和升级
│   │   ├── banner.ts             # ASCII 艺术横幅
│   │   └── at-resolver.ts        # @文件/@URL 引用展开
│   ├── core/
│   │   ├── agent/
│   │   │   └── loop.ts           # 代理循环 — 核心 ReAct 推理/行动循环
│   │   ├── tools/
│   │   │   ├── registry.ts       # 工具注册和查找
│   │   │   ├── executor.ts       # 工具执行（含用户确认）
│   │   │   ├── read_file.ts      # 读取文件内容
│   │   │   ├── write_file.ts     # 写入内容到文件
│   │   │   ├── edit_file.ts      # 替换文件中的精确字符串
│   │   │   ├── execute_shell.ts  # 运行 Shell 命令
│   │   │   ├── list_directory.ts # 列出目录树
│   │   │   └── search_files.ts   # 在文件中搜索文本
│   │   └── context/
│   │       ├── manager.ts        # 上下文窗口管理（Token 预算、裁剪）
│   │       └── project-guide.ts  # 加载 SEEKCODE.md / CLAUDE.md 项目指南
│   ├── providers/
│   │   └── deepseek/
│   │       ├── provider.ts       # DeepSeek LLM 提供商实现
│   │       └── client.ts         # OpenAI 兼容客户端工厂
│   ├── utils/
│   │   ├── display.ts            # 终端输出格式化
│   │   ├── confirm.ts            # Diff 预览和用户确认
│   │   ├── billing.ts            # 余额/用量查询和费用展示
│   │   ├── markdown.ts           # 流式 Markdown 转终端渲染器
│   │   └── interrupt.ts          # SIGINT 处理
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
├── SEEKCODE.md                   # Seek Code 项目指南
├── CLAUDE.md                     # AI 编码助手项目指南
└── README.md                     # 本文件
```

### 整体流程

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

### 代理循环 (`src/core/agent/loop.ts`)

代理循环是 Seek Code 的核心，遵循 ReAct（推理 + 行动）模式：

1. **系统提示**在每次会话中构建一次（保持稳定以最大化提示缓存命中率）
2. **用户消息**附加 `[cwd]` 和 `[date]` 前缀以提供上下文
3. **流式响应**来自 LLM — 处理文本增量、推理增量和工具调用增量
4. **如果收到工具调用**，执行每个工具并将结果反馈给 LLM
5. **如果是文本响应**（finish_reason = "stop"），输出给用户并结束
6. **循环**最多 30 次迭代以处理多步骤任务

关键设计决策：

- **系统提示稳定性**：系统提示只构建一次，会话期间不会更改。这最大化 DeepSeek 的提示缓存命中率。
- **上下文管理**：`ContextManager` 跟踪 Token 使用情况，超出预算时裁剪旧消息。
- **流式优先**：所有 LLM 通信通过 `AsyncIterable` 流式传输，实现实时终端输出。

### 工具系统

工具是 LLM 与用户环境交互的方式。每个工具实现 `Tool` 接口。

| 工具 | 描述 |
|---|---|
| `read_file` | 读取文件内容（截断至 30,000 字符） |
| `write_file` | 写入内容到文件（自动创建目录） |
| `edit_file` | 替换文件中的精确字符串 |
| `execute_shell` | 运行 Shell 命令（带超时） |
| `list_directory` | 列出目录树（可配置深度） |
| `search_files` | 在文件中搜索文本模式 |

**安全机制**：在执行破坏性操作（`write_file`、`edit_file`、`execute_shell`）之前，执行器会显示 diff 预览并请求用户确认，提供三个选项：是、本次会话全部允许、否。

### 上下文管理 (`src/core/context/manager.ts`)

`ContextManager` 维护对话历史：

- **Token 估算**：使用简单的 4:1 字符与 Token 比率
- **裁剪**：当估算 Token 数超过预算时，移除最旧的非系统消息
- **预算**：聊天模型默认 90,000 Token，推理模型 100,000 Token（1M 上下文窗口）

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

- `src/cli/` — 入口、REPL 循环、参数解析、技能、更新
- `src/core/agent/` — 代理循环和任务规划
- `src/core/tools/` — 文件读写、Shell 执行、搜索工具实现
- `src/core/context/` — 上下文窗口管理和项目指南加载
- `src/providers/` — LLM 提供商适配器，实现共享的 `LLMProvider` 接口
- `src/utils/` — 共享工具（显示、确认、计费、Markdown、中断）

详细开发说明请参阅：
- [开发指南（英文）](docs/development-guide.md)
- [开发者指南（中文）](docs/development-guide.zh-CN.md)

---

## 许可证

MIT
