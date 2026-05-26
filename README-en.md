# CodeGrunt

<p align="center">
  <img src="./assets/logo.png" alt="CodeGrunt Logo" width="50%" />
</p>

> An AI-powered CLI coding assistant for the terminal — built on DeepSeek.

[![npm version](https://img.shields.io/npm/v/codegrunt.svg)](https://www.npmjs.com/package/codegrunt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

CodeGrunt is an open-source, terminal-native AI coding assistant. It reads your codebase, understands context, and helps you write, refactor, debug, and ship code — all from the command line.

```bash
# Interactive REPL
codegrunt

# One-shot task
codegrunt "refactor the auth module to use async/await"
```

> 🇨🇳 [中文文档](./README.md)

---

## Features

- **🤖 P/G/E Agentic Coding** — Intentor → Planner → Generator → Evaluator four-phase architecture: intent classification (with auto skill matching) → task decomposition → pipeline execution (multi-turn tool calls per step) → quality evaluation with auto-refine (max 3 retries)
- **📂 Codebase-aware** — understands your project structure, imports, and conventions via `@` file references and project guide files (`CODEGRUNT.md` / `CLAUDE.md`)
- **🔌 DeepSeek powered** — ships with DeepSeek Chat, V4 Flash, V4 Pro, and R1 reasoner models
- **🛠️ Tool use** — 6 built-in tools (plugin-style registry with runtime add/remove): file read/write/edit, shell execution, directory listing, and code search — with diff preview and user confirmation for destructive operations
- **⚡ Streaming output** — real-time token streaming with Markdown rendering and reasoning visibility for a responsive terminal experience
- **📎 @-references** — inject file contents, directory listings, or web page content directly into your prompt with `@file.ts`, `@src/`, or `@https://example.com`
- **🎯 Slash commands** — `/init` to auto-generate project guide, `/model` to switch models, `/compact` to compress conversation history, `/review` to review changes, `/skills` to manage skills, and more
- **🔒 Safe by default** — destructive operations (write/edit/shell) show a diff preview and require user confirmation before applying, with "Yes for all" session mode
- **🔧 Skills system** — install and run reusable prompt templates as slash commands, with auto-discovery via Intentor keyword matching
- **💲 Cost tracking** — real-time session token usage and cost display with `/cost` and `/balance` commands
- **🎨 Modern Terminal UI** — Ink/React-based input components with arrow-key navigation, persistent history, and autocomplete dropdown
- **📋 Structured Logging** — Logger v2 with JSONL file logs (`~/.codegrunt/logs/`), trace IDs for cross-session correlation, and automatic log rotation (5 files × 5 MB)

---

## Quickstart

```bash
# Install globally
npm install -g codegrunt

# Set your API key
export DEEPSEEK_API_KEY=your_key_here

# Start an interactive session
codegrunt

# One-shot task
codegrunt "explain the architecture of this project"
```

On first run without an API key, CodeGrunt will launch an interactive setup wizard to guide you through configuration.

---

## Installation

**Requirements:** Node.js 18+

### npm (recommended)

```bash
npm install -g codegrunt
```

### pnpm

```bash
pnpm add -g codegrunt
```

### Build from source

```bash
git clone https://github.com/your-org/codegrunt.git
cd codegrunt
npm install
npm run build
npm link
```

---

## Usage

### Interactive REPL

```bash
codegrunt
```

Starts an interactive session with:

- ASCII art banner showing the model in use
- `>` prompt for entering tasks
- Tab completion for file paths (`@`) and slash commands (`/`)
- Multi-line input support
- Arrow-key history navigation
- Ink/React-powered modern terminal input interface

### One-shot mode

```bash
codegrunt "your task description"
```

Executes a single task and exits. Useful for scripting and quick queries.

### Slash Commands

| Command | Description |
|---|---|
| `/help` | Show help message with all available commands |
| `/model` | Switch model interactively (arrow-key selector) |
| `/model <id>` | Switch to a specific model (e.g., `/model deepseek-v4-pro`) |
| `/init` | Analyze the codebase and generate a `CODEGRUNT.md` project guide |
| `/clear` | Clear conversation context |
| `/compact` | Summarize and compress conversation history to save tokens |
| `/review` | Review session changes for logic issues |
| `/cost` | Show session token usage and estimated cost |
| `/balance` | Show account balance and usage (today / this month) |
| `/config` | Show or change configuration settings |
| `/reasoning` / `/effort` | Set reasoning effort for R1 models (low/medium/high) |
| `/skills` | List and manage skills (create, list) |
| `/exit` | Exit CodeGrunt |

### @-References

Reference files, directories, or URLs directly in your prompt:

| Syntax | Description | Example |
|---|---|---|
| `@<file>` | Inject file contents | `@src/index.ts` |
| `@<directory>` | Inject directory listing (up to 20 entries) | `@src/components/` |
| `@<url>` | Fetch and inject webpage content | `@https://example.com` |

Tab completion is supported for file and directory paths.

---

## Configuration

CodeGrunt is configured via environment variables or a `~/.codegrunt/config.json` file.

### Environment variables

| Variable | Description | Default |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key | — |
| `CODEGRUNT_MODEL` | Model ID to use | `deepseek-v4-pro` |
| `CODEGRUNT_PROVIDER` | LLM provider | `deepseek` |
| `CODEGRUNT_MAX_TOKENS` | Max tokens per response | `8192` |
| `CODEGRUNT_TEMPERATURE` | Response temperature (0-2) | `0.2` |
| `CODEGRUNT_BASE_URL` | Custom API base URL | `https://api.deepseek.com` |
| `CODEGRUNT_REASONING_EFFORT` | R1 reasoning effort: `low` \| `medium` \| `high` | `medium` |
| `CODEGRUNT_TOP_P` | Nucleus sampling (0-1) | `1` |
| `CODEGRUNT_FREQUENCY_PENALTY` | Repetition penalty (-2 to 2) | `0` |
| `CODEGRUNT_PRESENCE_PENALTY` | Topic diversity penalty (-2 to 2) | `0` |
| `CODEGRUNT_LOG_LEVEL` | Log level: `debug` \| `info` \| `warn` \| `error` | `info` |
| `CODEGRUNT_LOG_FILE` | Set to `0` or `false` to disable file logging | enabled |
| `CODEGRUNT_VERBOSE` | Enable verbose stderr output | disabled |

### Config file (`~/.codegrunt/config.json`)

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

The config file is auto-generated on first run via the setup wizard. Environment variables take precedence over the config file.

---

## Supported Models

| Provider | Models | Status |
|---|---|---|
| [DeepSeek](https://platform.deepseek.com/) | `deepseek-chat`, `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-reasoner` | ✅ Supported |

---

## Architecture

```
codegrunt/
├── src/
│   ├── cli/                      # CLI entry point, REPL, argument parsing
│   │   ├── index.ts              # Entry point (commander-based CLI)
│   │   ├── repl.ts               # Interactive REPL loop
│   │   ├── input.ts              # Multiline input, tab completion, list selector
│   │   ├── ink/                  # Ink/React terminal UI components
│   │   │   ├── PromptInput.tsx   # Main input (cursor, history, autocomplete)
│   │   │   ├── Dropdown.tsx      # Autocomplete dropdown overlay
│   │   │   ├── ListPicker.tsx    # Arrow-key list selector
│   │   │   ├── useAutocomplete.ts # File/command/skill completion
│   │   │   ├── useHistory.ts     # Persistent command history
│   │   │   └── types.ts          # Ink component types
│   │   ├── commands.ts           # Slash commands (/help, /model, /init, etc.)
│   │   ├── setup.ts              # First-run setup wizard
│   │   ├── skills.ts             # Skill loading and management
│   │   ├── update.ts             # Version check and upgrade
│   │   ├── banner.ts             # ASCII art banner
│   │   └── at-resolver.ts        # @file/@url reference expansion
│   ├── core/
│   │   ├── agent/
│   │   │   ├── loop.ts           # Agent loop — P/G/E orchestration entry
│   │   │   ├── intentor.ts       # Intent classifier (coding/chat/skill matching)
│   │   │   ├── planner.ts        # Task planner (multi-step decomposition)
│   │   │   └── evaluator.ts      # Quality evaluator (output check + auto-refine)
│   │   ├── pipeline/             # Harness-style pipeline engine
│   │   │   ├── engine.ts         # PipelineEngine: stage executor
│   │   │   ├── types.ts          # Pipeline context, stage interfaces, P/G/E types
│   │   │   └── stages/
│   │   │       ├── prepare-context.ts   # Build system prompt + inject project guide
│   │   │       ├── stream-response.ts   # Stream LLM call + token accumulation
│   │   │       ├── process-tools.ts     # Parse tool calls + execute + inject results
│   │   │       ├── process-tools-helpers.ts  # yes-for-all session state
│   │   │       └── post-process.ts      # Post-process: blind-write warnings, token stats
│   │   ├── tools/
│   │   │   ├── registry.ts       # Plugin-style ToolRegistry (runtime register/remove)
│   │   │   ├── executor.ts       # Tool execution (diff confirm, param validation)
│   │   │   ├── read_file.ts
│   │   │   ├── write_file.ts
│   │   │   ├── edit_file.ts
│   │   │   ├── execute_shell.ts
│   │   │   ├── list_directory.ts
│   │   │   └── search_files.ts
│   │   ├── context/
│   │   │   ├── manager.ts        # Context window management (token budget, trimming)
│   │   │   └── project-guide.ts  # Load CODEGRUNT.md / CLAUDE.md project guides
│   │   ├── events/
│   │   │   └── bus.ts            # Typed EventBus (pipeline/tool/LLM lifecycle events)
│   │   ├── observability/
│   │   │   ├── logger.ts         # Logger v2: file transport + trace IDs + rotation
│   │   │   └── metrics.ts        # Lightweight Metrics (counters, timers, snapshots)
│   │   └── di/
│   │       └── container.ts      # Service container/DI (singleton, transient lifecycles)
│   ├── providers/
│   │   └── deepseek/
│   │       ├── provider.ts       # DeepSeek LLM provider implementation
│   │       └── client.ts         # OpenAI-compatible client factory + API key validation
│   ├── utils/
│   │   ├── display.ts            # Terminal output formatting (plan, step, evaluation)
│   │   ├── confirm.ts            # Diff preview and user confirmation
│   │   ├── billing.ts            # Balance/usage querying and cost display
│   │   ├── markdown.ts           # Streaming Markdown-to-terminal renderer
│   │   ├── interrupt.ts          # SIGINT handling
│   │   ├── select.ts             # Interactive list selector (arrow-key navigation)
│   │   └── constants.ts          # Shared constants
│   ├── config.ts                 # Configuration loading (env vars, config file)
│   └── types.ts                  # Shared TypeScript types and interfaces
├── tests/
│   ├── tools/
│   │   ├── read_file.test.ts
│   │   ├── write_file.test.ts
│   │   └── execute_shell.test.ts
├── docs/                         # Documentation
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CODEGRUNT.md                   # Project guide for CodeGrunt
├── CLAUDE.md                     # Project guide for AI coding assistants
└── README.md                     # This file (Chinese)
```

### High-level flow

```
User Input (CLI / REPL)
       │
       ▼
  ┌──────────────┐
  │   Intentor   │  Intent: Skill match / Coding → P/G/E / Chat → direct gen
  └──────┬───────┘
         │
    ┌────▼─────────────────────────────────────┐
    │  Planner → Generator → Evaluator          │
    │   Plan       Execute     Evaluate          │
    │     (auto-refine on eval failure, max 3x)  │
    └──────────────────────────────────────────┘
         │
    ┌────▼──────────┐
    │  Pipeline      │  5 stages: prepare→stream→tools→post-process
    │  Engine        │
    └───────────────┘
         │
    ┌────▼────┐
    │  Tools  │  6 built-in + plugin registry
    │ (6+)    │
    └─────────┘
```

### Agent Loop (`src/core/agent/loop.ts`)

The agent loop uses a **P/G/E (Planner / Generator / Evaluator) + Intentor** architecture:

**Phase 0 — Intentor**: Classifies tasks into three paths — Skill match, Coding, or Chat. Uses fast heuristics first (keyword patterns, continuation detection, skill keyword overlap ≥40%); falls back to LLM only when ambiguous.

**Coding Flow — P/G/E Pipeline**:
1. **Planner**: Decomposes complex tasks into 2-5 independently verifiable steps. Skipped for short tasks (≤50 chars) and continuation signals
2. **Generator**: Pipeline engine executes each step — with **inner iteration** (multi-turn tool call loops per step)
3. **Evaluator**: Quality check / plan adherence / hallucination detection. Fails → injects feedback and retries (max 3). `pruneRefineMessages` cleans eval feedback between steps
4. `sessionHasRead` tracking prevents redundant file reads across turns

**Skill Flow**: Applies skill system prompt + content, then chat-style generation with tool call iteration.

**Chat Flow**: Skips Planner/Evaluator, uses Generator pipeline iteratively (up to 30 iterations). Prints fallback text if model returns empty.

Key design decisions:

- **System prompt stability**: Built once per session, never changes. Maximizes DeepSeek prompt cache hit rates.
- **Pipeline architecture**: Inspired by Harness CI/CD, 5 independently testable stages sharing a `PipelineContext`
- **EventBus**: All lifecycle events (pipeline start/complete, tool calls, LLM usage) published via typed EventBus
- **DI Container**: Services registered/resolved via `ServiceContainer`, supporting singleton and transient lifecycles
- **Streaming-first**: All LLM communication via `AsyncIterable<StreamChunk>` for real-time terminal output

### Tool System

Tools are how the LLM interacts with the user's environment. Each tool implements the `Tool` interface and is registered via the plugin-style `ToolRegistry` (supports runtime dynamic add/remove).

| Tool | Description |
|---|---|
| `read_file` | Read file contents (truncated at 30,000 chars) |
| `write_file` | Write content to a file (creates directories) |
| `edit_file` | Replace exact string in a file |
| `execute_shell` | Run shell commands with timeout |
| `list_directory` | List directory tree with configurable depth |
| `search_files` | Search for text patterns in files |

**Safety**: Before destructive operations, the executor shows a diff preview and asks for user confirmation with three options: Yes, Yes for all (session), No.

### Context Management (`src/core/context/manager.ts`)

`ContextManager` maintains the conversation history:

- **Token estimation**: Uses a simple 4:1 character-to-token ratio.
- **Trimming**: When the estimated token count exceeds the budget, oldest non-system messages are removed.
- **Budget**: Defaults to 90,000 tokens for chat models; 100,000 for reasoner models.

### Observability

- **Logger v2** (`observability/logger.ts`): Structured JSONL file logs (`~/.codegrunt/logs/`), trace IDs for cross-session correlation, log rotation (5 files × 5 MB), env var control
- **Metrics** (`observability/metrics.ts`): Counters/timers/snapshots with telemetry summary output
- **EventBus** (`events/bus.ts`): Typed event bus covering all lifecycle events

### Provider System

The DeepSeek provider implements the `LLMProvider` interface. The `StreamChunk` discriminated union supports:

- `text_delta` — incremental text output
- `reasoning_delta` — chain-of-thought reasoning (shown as "Thinking...")
- `tool_call_delta` — streaming tool call arguments
- `finish` — stream end with finish reason

---

## Development

### Commands

```bash
npm run dev        # dev mode with watch (tsx)
npm run build      # compile TypeScript to dist/
npm run typecheck  # type check only, no emit
npm test           # run vitest test suite
npm start          # run compiled dist/cli/index.js

# Run a single test file
npx vitest run tests/tools/read_file.test.ts
```

### Project Structure

- `src/cli/` — entry point, REPL loop, argument parsing, skills, updates, **Ink/React terminal UI**
- `src/core/agent/` — Intentor (intent + skill classification), Planner (task decomposition), Generator (pipeline execution), Evaluator (quality assessment)
- `src/core/pipeline/` — Harness-style pipeline engine (5 stages)
- `src/core/tools/` — file read/write, shell execution, search tool implementations
- `src/core/context/` — context window management and project guide loading
- `src/core/events/` — typed EventBus
- `src/core/observability/` — Logger v2 + Metrics
- `src/core/di/` — service container/DI
- `src/providers/` — LLM provider adapters implementing a shared `LLMProvider` interface
- `src/utils/` — shared utilities (display, confirm, billing, markdown, interrupt, selector)

For detailed development instructions, see:
- [Development Guide (English)](docs/development-guide-en.md)
- [开发者指南 (中文)](docs/development-guide.md)

---

## License

MIT
