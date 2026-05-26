# CodeGrunt — Development Guide

> How to build, test, and contribute to CodeGrunt from source.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Build System](#build-system)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Architecture Overview](#architecture-overview)
- [Adding a New LLM Provider](#adding-a-new-llm-provider)
- [Adding a New Tool](#adding-a-new-tool)
- [Configuration System](#configuration-system)
- [Release Process](#release-process)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Minimum Version |
|---|---|
| [Node.js](https://nodejs.org/) | 18.x (LTS recommended) |
| [npm](https://www.npmjs.com/) | 9.x (ships with Node 18+) |
| [Git](https://git-scm.com/) | 2.x |
| [TypeScript](https://www.typescriptlang.org/) | 5.5+ (installed via `npm install`) |

Optional but recommended:

- [pnpm](https://pnpm.io/) — faster alternative to npm
- [tsx](https://tsx.is/) — used for development hot-reload (included as dev dependency)

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/codegrunt.git
cd codegrunt
```

### 2. Install Dependencies

```bash
npm install
```

This installs all runtime and development dependencies defined in `package.json`.

### 3. Build the Project

```bash
npm run build
```

Compiles TypeScript from `src/` to JavaScript in `dist/`. The output is used by the `npm start` command and the published npm package.

### 4. Verify the Build

```bash
npm start -- --help
```

You should see the CLI help output. If you see `Error: No API key configured`, that's expected — you need to set up an API key to use the tool, but the build itself succeeded.

### 5. (Optional) Link Globally

```bash
npm link
```

Now you can run `codegrunt` from anywhere in your terminal.

---

## Project Structure

```
codegrunt/
├── src/
│   ├── cli/                  # CLI entry point, REPL, argument parsing
│   │   ├── index.ts          # Entry point (commander-based CLI)
│   │   ├── repl.ts           # Interactive REPL loop
│   │   ├── input.ts          # Multiline input, tab completion, list selector
│   │   ├── ink/              # Ink/React terminal UI components
│   │   │   ├── PromptInput.tsx   # Main input with cursor, history, autocomplete
│   │   │   ├── Dropdown.tsx      # Autocomplete dropdown overlay
│   │   │   ├── ListPicker.tsx    # Arrow-key list selector
│   │   │   ├── useAutocomplete.ts # File/slash/skill completion
│   │   │   ├── useHistory.ts     # Persistent command history
│   │   │   └── types.ts          # Ink component types
│   │   ├── commands.ts       # Slash commands (/help, /model, /init, etc.)
│   │   ├── setup.ts          # First-run setup wizard
│   │   ├── init.ts           # /init command: codebase analysis + CODEGRUNT.md gen
│   │   ├── skills.ts         # Skill loading and management
│   │   ├── update.ts         # Version check and upgrade
│   │   ├── banner.ts         # ASCII art banner
│   │   └── at-resolver.ts    # @file/@url reference expansion
│   ├── core/
│   │   ├── agent/
│   │   │   ├── loop.ts       # Agent loop — P/G/E orchestration entry
│   │   │   ├── intentor.ts   # Intent classifier (coding vs chat + skill matching)
│   │   │   ├── planner.ts    # Task planner (decomposes into multi-step plan)
│   │   │   └── evaluator.ts  # Quality evaluator (output check + auto-refine)
│   │   ├── pipeline/         # Harness-style pipeline engine
│   │   │   ├── engine.ts     # PipelineEngine: stage executor
│   │   │   ├── types.ts      # Pipeline context, stage interfaces, P/G/E types
│   │   │   └── stages/
│   │   │       ├── prepare-context.ts   # Build system prompt + inject project guide
│   │   │       ├── stream-response.ts   # Stream LLM call + token accumulation
│   │   │       ├── process-tools.ts     # Parse tool calls + execute + inject results
│   │   │       ├── process-tools-helpers.ts  # yes-for-all session state
│   │   │       └── post-process.ts      # Post-process: blind-write warnings, token stats
│   │   ├── tools/
│   │   │   ├── registry.ts   # Plugin-style ToolRegistry (runtime register/remove)
│   │   │   ├── executor.ts   # Tool execution (diff confirm, param validation)
│   │   │   ├── read_file.ts
│   │   │   ├── write_file.ts
│   │   │   ├── edit_file.ts
│   │   │   ├── execute_shell.ts
│   │   │   ├── list_directory.ts
│   │   │   └── search_files.ts
│   │   ├── context/
│   │   │   ├── manager.ts    # Context window management (token budget, trimming)
│   │   │   └── project-guide.ts  # Load CODEGRUNT.md / CLAUDE.md project guides
│   │   ├── events/
│   │   │   └── bus.ts        # Typed EventBus (pipeline/tool/LLM lifecycle events)
│   │   ├── observability/
│   │   │   ├── logger.ts     # Logger v2: file transport + trace IDs + log rotation
│   │   │   └── metrics.ts    # Lightweight Metrics (counters, timers, snapshots)
│   │   └── di/
│   │       └── container.ts  # Service container/DI (singleton, transient, lifecycle)
│   ├── providers/
│   │   └── deepseek/
│   │       ├── provider.ts   # DeepSeek LLM provider implementation
│   │       └── client.ts     # OpenAI-compatible client factory + API key validation
│   ├── utils/
│   │   ├── display.ts        # Terminal output formatting (plan, step, evaluation)
│   │   ├── confirm.ts        # Diff preview and user confirmation
│   │   ├── billing.ts        # Balance/usage querying and cost display
│   │   ├── markdown.ts       # Streaming Markdown-to-terminal renderer
│   │   ├── interrupt.ts      # SIGINT handling
│   │   ├── select.ts         # Interactive list selector (arrow-key navigation)
│   │   └── constants.ts      # Shared constants
│   ├── config.ts             # Configuration loading (env vars, config file)
│   └── types.ts              # Shared TypeScript types and interfaces
├── tests/
│   ├── tools/
│   │   ├── read_file.test.ts
│   │   ├── write_file.test.ts
│   │   └── execute_shell.test.ts
├── docs/                     # Documentation
├── dist/                     # Compiled output (gitignored)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CODEGRUNT.md               # Project guide for CodeGrunt
├── CLAUDE.md                 # Project guide for AI coding assistants
└── README.md
```

---

## Build System

### Compilation

CodeGrunt uses the standard TypeScript compiler (`tsc`) for production builds.

```bash
npm run build          # Compile src/ → dist/
npm run typecheck      # Type-check only, no output files
```

Key tsconfig.json points:

- target: ES2022 — modern JS output
- module: ESNext — ESM module system
- moduleResolution: bundler — works with tsx and tsc
- strict: true — full strict mode
- declaration: true — generate .d.ts files
- sourceMap: true — debug source maps
- jsx: react-jsx — JSX support for React/Ink components (jsxImportSource: react)

Key points:

- **ESM only**: The project uses `"type": "module"` in `package.json`. All imports use the `.js` extension convention.
- **`bundler` resolution**: Works with `tsx` for development and `tsc` for production.
- **`declaration: true`**: Generates `.d.ts` type declaration files for consumers.
- **JSX for Ink**: `src/cli/ink/` contains React components that render in the terminal via the `ink` library. TSX files use the `react-jsx` transform.

### Development vs Production

| Mode | Command | How it runs |
|---|---|---|
| Development | `npm run dev` | `tsx watch src/cli/index.ts` — hot-reload on file changes |
| Production | `npm run build` then `npm start` | Runs compiled `dist/cli/index.js` |
| One-shot (dev) | `npx tsx src/cli/index.ts "task"` | Direct execution without watch |

### Module System

The project uses **ES Modules (ESM)** exclusively:

- `package.json` has `"type": "module"`
- All imports use `import`/`export` syntax
- File extensions in imports use `.js` (the TypeScript convention for ESM)
- Dynamic imports use `import()` syntax

---

## Development Workflow

### Interactive Development

The fastest way to develop is using the watch mode:

```bash
npm run dev
```

This starts the REPL with `tsx watch`, which automatically restarts when you save changes to any `src/` file. No manual recompilation needed.

### One-shot Tasks

For quick testing of specific functionality:

```bash
npx tsx src/cli/index.ts "list files in the current directory"
```

### Type Checking

Run type checking separately to catch type errors without compiling:

```bash
npm run typecheck
```

---

## Testing

### Running Tests

```bash
npm test                          # Run all tests
npx vitest run                    # Same as above
npx vitest                        # Watch mode
```

### Running Individual Test Files

```bash
npx vitest run tests/tools/read_file.test.ts
npx vitest run tests/tools/write_file.test.ts
npx vitest run tests/tools/execute_shell.test.ts
```

> **Note:** Currently only 3 of the 6 tools have test files. Tests for `edit_file`, `list_directory`, and `search_files` are not yet implemented. Contributions adding these tests are welcome!

### Test Structure

Tests are located in `tests/` and mirror the `src/` structure. The test framework is [Vitest](https://vitest.dev/), configured in `vitest.config.ts`.

Key characteristics:

- **No API key required**: Tool-level unit tests operate on the local filesystem and shell.
- **Isolated filesystem**: Tests use temporary directories to avoid side effects.
- **Async tests**: Most tool tests are async since they interact with I/O.

---

## Architecture Overview

### High-Level Flow

```
User Input (CLI / REPL)
       │
       ▼
  ┌──────────────┐
  │   Intentor   │  Intent classification: Skill match / Coding → P/G/E / Chat → direct gen
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

**Phase 0 — Intentor**: Classifies the task into three paths:
- **Skill match** → `runSkillFlow`: Applies skill system prompt + content, then chat-style generation
- **Coding** → `runCodingFlow`: P/G/E pipeline with plan → execute → evaluate → refine
- **Chat** → `runChatFlow`: Direct generator pipeline, skipping Planner/Evaluator

Intentor uses fast heuristics first:
- **Keyword patterns**: Coding signals (write/create/fix/refactor) vs non-coding (explain/what is/summarize)
- **Continuation detection**: Short imperative phrases like "继续", "go on", "next" default to coding path
- **Skill matching**: Keyword overlap between task and skill name/description (≥40% match required)

LLM-based classification only fires when heuristics are ambiguous, saving latency and cost.

**Coding Flow — P/G/E Pipeline**:
1. **Planner**: Decomposes complex tasks into 2-5 independently verifiable steps, using low-temperature (0.1) structured JSON output. Skipped for short tasks (≤50 chars) and continuation signals
2. **Generator**: Pipeline engine executes each step sequentially → prepare context → stream LLM call → tool execution → post-process. Now supports **inner iteration** — multi-turn tool call loops within a single step
3. **Evaluator**: Checks output quality / plan adherence / hallucinations. If it fails, injects feedback and retries (max 3x, up from 2x). `pruneRefineMessages()` cleans evaluation feedback messages between steps
4. `sessionHasRead` tracking prevents redundant file reads across turns

**Chat Flow**: Skips Planner/Evaluator, uses Generator pipeline iteratively until model stops (up to 30 iterations). Prints fallback text "(no text response from model)" if model returns empty.

**Skill Flow**: Applies skill system prompt + content, then uses tool-call iteration loop like chat flow.

Key design decisions:

- **System prompt stability**: Built once per session, never changes. Maximizes DeepSeek prompt cache hit rates.
- **Pipeline architecture**: Inspired by Harness CI/CD, 5 independently testable stages sharing a `PipelineContext`
- **EventBus**: All lifecycle events (pipeline start/complete, tool calls, LLM usage) published via typed EventBus
- **DI Container**: Services registered/resolved via `ServiceContainer`, supporting singleton and transient lifecycles
- **Streaming-first**: All LLM communication via `AsyncIterable<StreamChunk>` for real-time terminal output

### Tool System

Tools are how the LLM interacts with the user's environment. Each tool implements the `Tool` interface and is registered via the plugin-style `ToolRegistry` (supports runtime dynamic add/remove).

Six built-in tools:

| Tool | Description |
|---|---|
| `read_file` | Read file contents (truncated at 30,000 chars) |
| `write_file` | Write content to a file (creates directories) |
| `edit_file` | Replace exact string in a file (string-match editing) |
| `execute_shell` | Run shell commands with timeout |
| `list_directory` | List directory tree with configurable depth |
| `search_files` | Search for text patterns in files |

**Safety**: Before destructive operations, the executor shows a diff preview and asks for user confirmation with three options: Yes, Yes for all (session), No.

### Pipeline Engine (`src/core/pipeline/`)

Inspired by Harness CI/CD pipelines, each agent interaction is decomposed into 5 independent stages:

| Stage | File | Responsibility |
|---|---|---|
| PrepareContext | `prepare-context.ts` | Build system prompt, inject project guide, init messages |
| StreamResponse | `stream-response.ts` | Stream LLM call, accumulate text/reasoning/tool calls |
| ProcessToolCalls | `process-tools.ts` | Parse tool calls, execute via executor, inject results |
| ProcessToolHelpers | `process-tools-helpers.ts` | yes-for-all session-level state management |
| PostProcess | `post-process.ts` | Blind-write detection, token stats, final output formatting |

All stages share a `PipelineContext`, executed sequentially by `PipelineEngine`.

### Context Management (`src/core/context/manager.ts`)

The `ContextManager` maintains the conversation history:

- **Token estimation**: Uses a simple 4:1 character-to-token ratio.
- **Trimming**: When the estimated token count exceeds the budget, oldest non-system messages are removed.
- **Budget**: Defaults to 90,000 tokens for chat models; 100,000 for reasoner models (1M context window).

### Provider System

All LLM backends implement the `LLMProvider` interface. The `StreamChunk` union type supports:

- `text_delta` — incremental text output
- `reasoning_delta` — chain-of-thought reasoning (displayed as "Thinking...")
- `tool_call_delta` — streaming tool call arguments
- `finish` — end-of-stream with finish reason

### Observability

- **Logger v2** (`observability/logger.ts`): Structured leveled logging with namespace support. Features:
  - **File transport**: Structured JSONL logs written to `~/.codegrunt/logs/`
  - **Trace IDs**: Unique `runId` for correlating entries across a single session. Created via `createLogger('namespace', runId)`
  - **Log rotation**: Keeps last 5 log files, max 5 MB each
  - **Environment control**: `CODEGRUNT_LOG_LEVEL` (debug/info/warn/error), `CODEGRUNT_LOG_FILE` (0/false to disable), `CODEGRUNT_VERBOSE`
  - Errors auto-published to EventBus
- **Metrics** (`observability/metrics.ts`): Counters/timers/snapshots with telemetry summary output
- **EventBus** (`events/bus.ts`): Typed event bus covering all lifecycle events (pipeline, tools, LLM, conversation)

### Ink/React Terminal UI (`src/cli/ink/`)

CodeGrunt includes a modern React-based terminal UI built with the `ink` library:

| Component | Description |
|---|---|
| `PromptInput.tsx` | Main input with cursor movement, history navigation up/down, autocomplete dropdown, Ctrl+C cancel |
| `Dropdown.tsx` | Autocomplete overlay with `❯` indicator, skill/builtin/file kind coloring, max 8 items visible |
| `ListPicker.tsx` | Arrow-key selector for interactive model/config selection |
| `useAutocomplete.ts` | File path (`@`) completion, slash command completion, skill name completion |
| `useHistory.ts` | Persistent command history with arrow-key navigation |

---

## Adding a New LLM Provider

### Step 1: Create the Provider Directory

```bash
mkdir -p src/providers/myprovider
```

### Step 2: Implement the Provider

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

### Step 3: Register the Provider

In `src/cli/index.ts`:

```typescript
import { MyProvider } from './providers/myprovider/provider.js';
const provider = new MyProvider(config);
```

### Step 4: Add Configuration Support

Update `src/config.ts` to support your provider's configuration.

### Provider Contract

Your provider must:

1. Accept `Message[]` in OpenAI-compatible format
2. Return `AsyncIterable<StreamChunk>`
3. Support `AbortSignal` for cancellation
4. Handle tool definitions (passed via `options.tools`)
5. Respect `options.model`, `options.maxTokens`, `options.temperature`

---

## Adding a New Tool

### Step 1: Create the Tool File

```typescript
// src/core/tools/my_tool.ts
import type { Tool, ToolResult } from '../../types.js';

export const myTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'my_tool',
      description: 'What this tool does',
      parameters: {
        type: 'object',
        properties: {
          param1: { type: 'string', description: 'Description of param1' },
        },
        required: ['param1'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      return { success: true, output: 'Result string' };
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

### Step 2: Register the Tool

Add to `src/core/tools/registry.ts` in the `ToolRegistry.registerBuiltins()` method:

```typescript
import { myTool } from './my_tool.js';
// Add myTool to the builtins array in registerBuiltins()
```

### Step 3: Add Safety Confirmation (if destructive)

Add confirmation logic in `src/core/tools/executor.ts` (follow the `edit_file`/`write_file` pattern).

### Step 4: Write Tests

```typescript
// tests/tools/my_tool.test.ts
import { describe, it, expect } from 'vitest';
import { myTool } from '../../src/core/tools/my_tool.js';

describe('my_tool', () => {
  it('works correctly', async () => {
    const result = await myTool.execute({ param1: 'test' });
    expect(result.success).toBe(true);
  });
});
```

---

## Slash Commands

CodeGrunt provides a set of slash commands available in the interactive REPL, implemented in `src/cli/commands.ts`.

| Command | Description |
|---|---|
| `/help` | Show available commands and current configuration |
| `/model <name>` | Switch the active LLM model (interactive if no name) |
| `/init` | Analyze the codebase and generate a CODEGRUNT.md project guide |
| `/clear` | Clear the conversation history |
| `/compact` | Summarize and compress conversation history to save tokens |
| `/review` | Review session changes for logic issues |
| `/cost` | Show token usage and estimated cost for the session |
| `/balance` | Show account balance and usage (today / this month) |
| `/config` | Show or change configuration settings |
| `/reasoning` / `/effort` | Set reasoning effort for R1 models (low/medium/high) |
| `/token` | Update your DeepSeek API key |
| `/skills` | List and manage skills (create, list) |
| `/exit` | Exit CodeGrunt |

---

## @-Reference Syntax

CodeGrunt supports `@`-references in both REPL and one-shot mode, implemented in `src/cli/at-resolver.ts`.

### File References

```bash
codegrunt "explain @src/core/agent/loop.ts"
codegrunt "compare @src/config.ts and @src/types.ts"
```

### URL References

```bash
codegrunt "summarize @https://example.com/docs/api"
```

---

## Configuration System

CodeGrunt's config loading chain (highest to lowest priority):

1. Environment variables (e.g., `CODEGRUNT_MODEL`)
2. `~/.codegrunt/config.json` config file
3. Hardcoded defaults (`DEFAULTS` in `src/config.ts`)

### Key Config Items

| Config | Env Variable | Default |
|---|---|---|
| API Key | `DEEPSEEK_API_KEY` | — |
| Model | `CODEGRUNT_MODEL` | `deepseek-v4-pro` |
| Max Tokens | `CODEGRUNT_MAX_TOKENS` | `8192` |
| Temperature | `CODEGRUNT_TEMPERATURE` | `0.2` |
| Reasoning Effort | `CODEGRUNT_REASONING_EFFORT` | `medium` |
| Top-P | `CODEGRUNT_TOP_P` | `1` |
| Frequency Penalty | `CODEGRUNT_FREQUENCY_PENALTY` | `0` |
| Presence Penalty | `CODEGRUNT_PRESENCE_PENALTY` | `0` |
| Base URL | `CODEGRUNT_BASE_URL` | `https://api.deepseek.com` |
| Log Level | `CODEGRUNT_LOG_LEVEL` | `info` |
| File Logging | `CODEGRUNT_LOG_FILE` | enabled |
| Verbose | `CODEGRUNT_VERBOSE` | disabled |

### Model Detection (`src/config.ts`)

- `isReasonerModel(model)`: Detects R1 reasoner models (ID contains `reasoner` or `r1`)
- `supportsReasoning(model)`: Detects reasoning_content support (R1 models + V4 Pro)
- Reasoner models: larger context budget (`CONTEXT_BUDGET = 100_000`), no temperature support
- Chat models: standard budget (`CHAT_CONTEXT_BUDGET = 90_000`), full parameter support

---

## Release Process

1. Bump version in `package.json`
2. Run `npm run build` to verify compilation
3. Run `npm test` to verify tests pass
4. Commit changes and tag: `git tag v<version>`
5. Publish: `npm publish`

---

## Troubleshooting

| Issue | Likely Cause | Solution |
|---|---|---|
| `Error: No API key configured` | `DEEPSEEK_API_KEY` not set | Run `codegrunt` to launch setup wizard, or `export DEEPSEEK_API_KEY=sk-...` |
| Build fails | Node.js version too old | Ensure Node.js 18+ |
| Type errors | Stale `node_modules` | Run `npm install` |
| `MODULE_NOT_FOUND` | Missing `.js` extension in import | ESM requires `.js` suffix in imports |
| Tool calls unresponsive | API quota exhausted | Check `/balance` command output |
| JSX compile errors in `src/cli/ink/` | Missing React types | Run `npm install` to ensure `@types/react` is installed |
