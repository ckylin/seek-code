# Seek Code

<p align="center">
  <img src="./assets/logo.png" alt="Seek Code Logo" width="50%" />
</p>

> An AI-powered CLI coding assistant for the terminal — built on DeepSeek.

[![npm version](https://img.shields.io/npm/v/seekcode.svg)](https://www.npmjs.com/package/seekcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

Seek Code is an open-source, terminal-native AI coding assistant. It reads your codebase, understands context, and helps you write, refactor, debug, and ship code — all from the command line.

```bash
# Interactive REPL
seekcode

# One-shot task
seekcode "refactor the auth module to use async/await"
```

> 🇨🇳 [中文文档](./README.md)

---

## Features

- **🤖 Agentic coding** — Seek Code can read files, edit code, run shell commands, search codebase, and iterate autonomously on multi-step tasks using a ReAct (Reasoning + Acting) loop
- **📂 Codebase-aware** — understands your project structure, imports, and conventions via `@` file references and project guide files (`SEEKCODE.md` / `CLAUDE.md`)
- **🔌 DeepSeek powered** — ships with DeepSeek Chat, V4 Flash, V4 Pro, and R1 reasoner models
- **🛠️ Tool use** — 6 built-in tools: file read/write/edit, shell execution, directory listing, and code search — with diff preview and user confirmation for destructive operations
- **⚡ Streaming output** — real-time token streaming with Markdown rendering and reasoning visibility for a responsive terminal experience
- **📎 @-references** — inject file contents, directory listings, or web page content directly into your prompt with `@file.ts`, `@src/`, or `@https://example.com`
- **🎯 Slash commands** — `/init` to auto-generate project guide, `/model` to switch models, `/compact` to compress conversation history, `/review` to review changes, `/skills` to manage skills, and more
- **🔒 Safe by default** — destructive operations (write/edit/shell) show a diff preview and require user confirmation before applying
- **🔧 Skills system** — install and run reusable prompt templates as slash commands from `.zip` files
- **💲 Cost tracking** — real-time session token usage and cost display with `/cost` and `/balance` commands

---

## Quickstart

```bash
# Install globally
npm install -g seekcode

# Set your API key
export DEEPSEEK_API_KEY=your_key_here

# Start an interactive session
seekcode

# One-shot task
seekcode "explain the architecture of this project"
```

On first run without an API key, Seek Code will launch an interactive setup wizard to guide you through configuration.

---

## Installation

**Requirements:** Node.js 18+

### npm (recommended)

```bash
npm install -g seekcode
```

### pnpm

```bash
pnpm add -g seekcode
```

### Build from source

```bash
git clone https://github.com/your-org/seekcode.git
cd seekcode
npm install
npm run build
npm link
```

---

## Usage

### Interactive REPL

```bash
seekcode
```

Starts an interactive session with:

- ASCII art banner showing the model in use
- `>` prompt for entering tasks
- Tab completion for file paths (`@`) and slash commands (`/`)
- Multi-line input support
- Arrow-key history navigation

### One-shot mode

```bash
seekcode "your task description"
```

Executes a single task and exits. Useful for scripting and quick queries.

### Slash Commands

| Command | Description |
|---|---|
| `/help` | Show help message with all available commands |
| `/model` | Switch model interactively (arrow-key selector) |
| `/model <id>` | Switch to a specific model (e.g., `/model deepseek-v4-pro`) |
| `/init` | Analyze the codebase and generate a `SEEKCODE.md` project guide |
| `/clear` | Clear conversation context |
| `/compact` | Summarize and compress conversation history to save tokens |
| `/review` | Review session changes for logic issues |
| `/cost` | Show session token usage and estimated cost |
| `/balance` | Show account balance and usage (today / this month) |
| `/config` | Show or change configuration settings |
| `/reasoning` / `/effort` | Set reasoning effort for R1 models (low/medium/high) |
| `/token` | Update your DeepSeek API key |
| `/skills` | List and manage skills (create, list) |
| `/exit` | Exit Seek Code |

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

Seek Code is configured via environment variables or a `~/.seekcode/config.json` file.

### Environment variables

| Variable | Description | Default |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key | — |
| `SEEKCODE_MODEL` | Model ID to use | `deepseek-v4-pro` |
| `SEEKCODE_PROVIDER` | LLM provider | `deepseek` |
| `SEEKCODE_MAX_TOKENS` | Max tokens per response | `8192` |
| `SEEKCODE_TEMPERATURE` | Response temperature (0-2) | `0.2` |
| `SEEKCODE_BASE_URL` | Custom API base URL | `https://api.deepseek.com` |
| `SEEKCODE_REASONING_EFFORT` | R1 reasoning effort: `low` \| `medium` \| `high` | `medium` |
| `SEEKCODE_TOP_P` | Nucleus sampling (0-1) | `1` |
| `SEEKCODE_FREQUENCY_PENALTY` | Repetition penalty (-2 to 2) | `0` |
| `SEEKCODE_PRESENCE_PENALTY` | Topic diversity penalty (-2 to 2) | `0` |

### Config file (`~/.seekcode/config.json`)

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
seekcode/
├── src/
│   ├── cli/                      # CLI entry point, REPL, argument parsing
│   │   ├── index.ts              # Entry point (commander-based CLI)
│   │   ├── repl.ts               # Interactive REPL loop
│   │   ├── input.ts              # Multiline input, tab completion, list selector
│   │   ├── commands.ts           # Slash commands (/help, /model, /init, etc.)
│   │   ├── setup.ts              # First-run setup wizard
│   │   ├── skills.ts             # Skill loading and management
│   │   ├── update.ts             # Version check and upgrade
│   │   ├── banner.ts             # ASCII art banner
│   │   └── at-resolver.ts        # @file/@url reference expansion
│   ├── core/
│   │   ├── agent/
│   │   │   └── loop.ts           # Agentic loop — the core ReAct reasoning/action cycle
│   │   ├── tools/
│   │   │   ├── registry.ts       # Tool registration and lookup
│   │   │   ├── executor.ts       # Tool execution with user confirmation
│   │   │   ├── read_file.ts      # Read file contents
│   │   │   ├── write_file.ts     # Write content to file
│   │   │   ├── edit_file.ts      # Replace exact string in file
│   │   │   ├── execute_shell.ts  # Run shell commands
│   │   │   ├── list_directory.ts # List directory tree
│   │   │   └── search_files.ts   # Search text in files
│   │   └── context/
│   │       ├── manager.ts        # Context window management (token budget, trimming)
│   │       └── project-guide.ts  # Load SEEKCODE.md / CLAUDE.md project guides
│   ├── providers/
│   │   └── deepseek/
│   │       ├── provider.ts       # DeepSeek LLM provider implementation
│   │       └── client.ts         # OpenAI-compatible client factory
│   ├── utils/
│   │   ├── display.ts            # Terminal output formatting
│   │   ├── confirm.ts            # Diff preview and user confirmation
│   │   ├── billing.ts            # Balance/usage querying and cost display
│   │   ├── markdown.ts           # Streaming Markdown-to-terminal renderer
│   │   └── interrupt.ts          # SIGINT handling
│   ├── config.ts                 # Configuration loading (env vars, config file)
│   └── types.ts                  # Shared TypeScript types and interfaces
├── tests/
│   ├── tools/
│   │   ├── read_file.test.ts
│   │   ├── write_file.test.ts
│   │   └── execute_shell.test.ts
├── docs/
│   ├── development-guide.md      # Development guide (English)
│   ├── development-guide.zh-CN.md # Development guide (Chinese)
│   └── VERSION.md                # Release process guide
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── SEEKCODE.md                   # Project guide for Seek Code
├── CLAUDE.md                     # Project guide for AI coding assistants
└── README.md                     # This file (Chinese)
```

### High-level flow

```
User input (CLI / REPL)
       │
       ▼
  ┌─────────────┐
  │ Agent Loop  │ ◄──── LLM Provider (streaming)
  │  (loop.ts)  │ ────► Tool Execution
  └──────┬──────┘
         │
    ┌────┴────┐
    │  Tools  │
    │ (6)     │
    └─────────┘
```

### Agent Loop (`src/core/agent/loop.ts`)

The agent loop is the core of Seek Code. It follows a ReAct (Reasoning + Acting) pattern:

1. **System prompt** is built once per session (stays stable to maximize prompt cache hits)
2. **User message** is prefixed with `[cwd]` and `[date]` for context
3. **Streaming response** from the LLM — handles text deltas, reasoning deltas, and tool call deltas
4. **If tool calls are received**, each tool is executed and results are fed back to the LLM
5. **If text response** (finish_reason = "stop"), output to user and end
6. **Loops** up to 30 iterations for multi-step tasks

Key design decisions:

- **System prompt stability**: The system prompt is built once and never changes during a session. This maximizes DeepSeek's prompt cache hit rate.
- **Context management**: `ContextManager` tracks token usage and trims old messages when budget is exceeded.
- **Streaming-first**: All LLM communication is streamed via `AsyncIterable`, enabling real-time terminal output.

### Tool System

Tools are how the LLM interacts with the user's environment. Each tool implements the `Tool` interface.

| Tool | Description |
|---|---|
| `read_file` | Read file contents (truncated at 30,000 chars) |
| `write_file` | Write content to file (auto-creates directories) |
| `edit_file` | Replace an exact string in a file |
| `execute_shell` | Run a shell command (with timeout) |
| `list_directory` | List directory tree (configurable depth) |
| `search_files` | Search for a text pattern in files |

**Safety**: Before destructive operations (`write_file`, `edit_file`, `execute_shell`), the executor shows a diff preview and asks for user confirmation with options: Yes, Yes for all (session), or No.

### Context Management (`src/core/context/manager.ts`)

The `ContextManager` maintains conversation history:

- **Token estimation**: Uses a simple 4:1 character-to-token ratio
- **Trimming**: When estimated tokens exceed budget, removes oldest non-system messages
- **Budget**: Defaults to 90,000 tokens for chat models, 100,000 for reasoner models (1M context window)

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

- `src/cli/` — entry point, REPL loop, argument parsing, skills, updates
- `src/core/agent/` — agentic loop and task planning
- `src/core/tools/` — file read/write, shell execution, search tool implementations
- `src/core/context/` — context window management and project guide loading
- `src/providers/` — LLM provider adapters implementing a shared `LLMProvider` interface
- `src/utils/` — shared utilities (display, confirm, billing, markdown, interrupt)

For detailed development instructions, see:
- [Development Guide (English)](docs/development-guide.md)
- [开发者指南 (中文)](docs/development-guide.zh-CN.md)

---

## License

MIT
