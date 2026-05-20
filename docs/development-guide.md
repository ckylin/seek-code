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
│   │   ├── commands.ts       # Slash commands (/help, /model, /init, etc.)
│   │   ├── setup.ts          # First-run setup wizard
│   │   ├── skills.ts         # Skill loading and management
│   │   ├── update.ts         # Version check and upgrade
│   │   ├── banner.ts         # ASCII art banner
│   │   └── at-resolver.ts    # @file/@url reference expansion
│   ├── core/
│   │   ├── agent/
│   │   │   └── loop.ts       # Agentic loop — the core reasoning/action cycle
│   │   ├── tools/
│   │   │   ├── registry.ts   # Tool registration and lookup
│   │   │   ├── executor.ts   # Tool execution with user confirmation
│   │   │   ├── read_file.ts
│   │   │   ├── write_file.ts
│   │   │   ├── edit_file.ts
│   │   │   ├── execute_shell.ts
│   │   │   ├── list_directory.ts
│   │   │   └── search_files.ts
│   │   └── context/
│   │       ├── manager.ts    # Context window management (token budget, trimming)
│   │       └── project-guide.ts  # Load CODEGRUNT.md / CLAUDE.md project guides
│   ├── providers/
│   │   └── deepseek/
│   │       ├── provider.ts   # DeepSeek LLM provider implementation
│   │       └── client.ts     # OpenAI-compatible client factory
│   ├── utils/
│   │   ├── display.ts        # Terminal output formatting
│   │   ├── confirm.ts        # Diff preview and user confirmation
│   │   ├── billing.ts        # Balance/usage querying and cost display
│   │   ├── markdown.ts       # Streaming Markdown-to-terminal renderer
│   │   └── interrupt.ts      # SIGINT handling
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

The `tsconfig.json` configuration:

```json
{
  "compilerOptions": {
    "target": "ES2022",          // Modern JS output
    "module": "ESNext",          // ESM module system
    "moduleResolution": "bundler", // Works with bundlers and tsx
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,              // Full strict mode
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,         // Generate .d.ts files
    "sourceMap": true            // Debug source maps
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

Key points:

- **ESM only**: The project uses `"type": "module"` in `package.json`. All imports use the `.js` extension convention (e.g., `import { foo } from './bar.js'`).
- **`bundler` resolution**: This works with `tsx` for development and `tsc` for production. It does not require `exports` fields in `package.json` of dependencies.
- **`declaration: true`**: Generates `.d.ts` type declaration files for consumers.

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

### Linting

Currently the project does not have a linter configured. Consider adding ESLint for larger contributions.

### Debugging

CodeGrunt offers multiple debugging approaches, from quick log printing to full IDE breakpoint debugging. The following are listed in recommended order.

---

#### Method 1: VS Code Built-in Breakpoint Debugging (Highly Recommended)

The project includes a pre-configured `.vscode/launch.json` — ready to use out of the box. Press `Ctrl+Shift+D` to open the Debug panel, select a configuration from the dropdown, and press `F5` to start.

**5 Debug Configurations:**

| Configuration | Purpose | Use Case |
|---|---|---|
| 🚀 Launch REPL (Interactive Mode) | Start interactive CLI in debug mode | Debug command handling, REPL UI, input completion |
| 🔧 One-Shot Task Debug | Execute a single task then exit | Debug the full Agent loop, tool call chain |
| 🧪 Debug Current Test File | Run and debug the currently open test file | Debug a specific tool's unit test |
| 🧪 Debug All Tests | Run and debug all tests | Check overall test quality |
| 🌐 Chrome DevTools Remote Debug | Start with `--inspect`, debug in Chrome | When you prefer browser DevTools |

**Configuration file (`.vscode/launch.json`):**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "🚀 Launch REPL (Interactive Mode)",
      "type": "node",
      "request": "launch",
      "runtimeArgs": ["--import", "tsx"],
      "args": ["src/cli/index.ts"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    },
    {
      "name": "🔧 One-Shot Task Debug",
      "type": "node",
      "request": "launch",
      "runtimeArgs": ["--import", "tsx"],
      "args": ["src/cli/index.ts", "list files in the current directory"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    },
    {
      "name": "🧪 Debug Current Test File",
      "type": "node",
      "request": "launch",
      "runtimeArgs": [
        "--import", "tsx",
        "${workspaceFolder}/node_modules/vitest/vitest.mjs"
      ],
      "args": ["run", "${relativeFile}"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    },
    {
      "name": "🧪 Debug All Tests",
      "type": "node",
      "request": "launch",
      "runtimeArgs": [
        "--import", "tsx",
        "${workspaceFolder}/node_modules/vitest/vitest.mjs"
      ],
      "args": ["run"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    },
    {
      "name": "🌐 Chrome DevTools Remote Debug",
      "type": "node",
      "request": "launch",
      "runtimeArgs": ["--inspect", "--import", "tsx"],
      "args": ["src/cli/index.ts"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

**Additional VS Code settings (`.vscode/settings.json`):**

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

This ensures VS Code uses the project's installed TypeScript version, avoiding type-check inconsistencies.

---

#### Method 2: Chrome DevTools Remote Debugging

If you prefer Chrome's browser developer tools, start with:

```bash
# Start with --inspect flag from the terminal
node --inspect --import tsx src/cli/index.ts
```

Then open `chrome://inspect` in Chrome and click **"Open dedicated DevTools for Node"**. A dedicated DevTools window will open where you can:

- Set breakpoints on TypeScript source in the Sources panel
- Execute expressions in the Console panel
- View the call stack, variables, and scope

> **Note**: `tsconfig.json` already has `"sourceMap": true` enabled, so Source Maps automatically map compiled JS back to TypeScript source.

---

#### Method 3: console.error Log Debugging (Fastest)

Since CodeGrunt's tool output is communicated via **stdout**, **never use `console.log()`** — it will pollute tool output and break parsing.

```typescript
// ✅ Correct: outputs to stderr, doesn't affect tool output
console.error('[DEBUG] params:', params);
console.error('[DEBUG] state:', JSON.stringify(state, null, 2));

// ❌ Wrong: outputs to stdout, breaks tool output
console.log('[DEBUG] params:', params);
```

---

#### Method 4: Development Hot-Reload Mode

When you don't need full breakpoint debugging, watch mode is the fastest approach:

```bash
npm run dev
```

The program auto-restarts every time you save a file under `src/`. Combine with `console.error` logs for fast iteration.

---

#### Module Breakpoint Location Quick Reference

Based on what you want to debug, set breakpoints at the corresponding file and location:

| Debug Target | Key File | Recommended Breakpoint Location |
|---|---|---|
| **REPL startup flow** | `src/cli/repl.ts` | `startRepl()` function entry (~line 15) |
| **User input handling** | `src/cli/input.ts` | `question()` function (~line 80) |
| **Multi-line input parsing** | `src/cli/input.ts` | `isInputTuple()` return statement |
| **@-reference resolution** | `src/cli/at-resolver.ts` | `resolveAtReferences()` function entry |
| **Slash command dispatch** | `src/cli/commands.ts` | `handleSlashCommand()` switch statement |
| **Agent Loop — message building** | `src/core/agent/loop.ts` | `messages.push()` call in `runAgentLoop()` |
| **Agent Loop — LLM call** | `src/core/agent/loop.ts` | `provider.stream()` call site |
| **Agent Loop — tool call parsing** | `src/core/agent/loop.ts` | After `toolCalls` variable assignment |
| **Agent Loop — result return** | `src/core/agent/loop.ts` | `finalResponse` assignment |
| **Tool registration** | `src/core/tools/registry.ts` | `getTool()` call site |
| **Tool execution — parameter validation** | `src/core/tools/executor.ts` | `executeToolCall()` function entry |
| **Tool execution — confirmation prompt** | `src/core/tools/executor.ts` | `confirm()` call site |
| **Tool execution — result construction** | `src/core/tools/executor.ts` | `return` statement |
| **read_file tool** | `src/core/tools/read_file.ts` | `execute()` function entry |
| **write_file tool** | `src/core/tools/write_file.ts` | `execute()` entry, before `writeFile()` |
| **edit_file tool** | `src/core/tools/edit_file.ts` | String match replacement logic |
| **execute_shell tool** | `src/core/tools/execute_shell.ts` | Before/after `exec()` call |
| **LLM request sending** | `src/providers/deepseek/provider.ts` | `stream()` method entry |
| **LLM stream response handling** | `src/providers/deepseek/provider.ts` | Inside `for await` loop |
| **Token usage stats** | `src/providers/deepseek/provider.ts` | `usage` object construction |
| **Context trimming** | `src/core/context/manager.ts` | `trim()` method |
| **Project guide loading** | `src/core/context/project-guide.ts` | `loadProjectGuide()` function |
| **Configuration loading** | `src/config.ts` | `loadConfig()` function |
| **Cost/balance query** | `src/utils/billing.ts` | `fetchBalance()` function |
| **Diff preview** | `src/utils/confirm.ts` | `confirm()` function |

---

#### Hands-On: 5 Debugging Scenario Walkthroughs

##### Scenario A: Debug REPL Startup and UI Interaction

1. Open the project in VS Code
2. Press `Ctrl+Shift+D` to switch to the Debug panel
3. Select **"🚀 Launch REPL (Interactive Mode)"** from the dropdown
4. Set a breakpoint at the `handleSlashCommand()` function entry in `src/cli/commands.ts` (press `F9`)
5. Press `F5` to start debugging
6. The program starts and the REPL shows a prompt in the integrated terminal
7. Type `/help` and press Enter in the terminal
8. The breakpoint triggers, you can:
   - Press `F10` to Step Over
   - Press `F11` to Step Into
   - Hover over variables to inspect values
   - Check the full scope in the Variables panel
9. Continue execution (`F5`) and observe the `/help` output

##### Scenario B: Debug a Complete Conversation Flow

1. Select **"🔧 One-Shot Task Debug"**
2. Set breakpoints in `runAgentLoop()` in `src/core/agent/loop.ts` at these locations:
   - Function entry (inspect parameters)
   - After `messages.push(userMessage)` (inspect message construction)
   - At `provider.stream()` call (inspect LLM request)
   - After `toolCalls` parsing (inspect tool calls)
   - At `finalResponse` assignment (inspect final result)
3. Press `F5` to start
4. At each breakpoint, check:
   - Whether the message list is correct (system + user)
   - Whether the LLM request parameters are complete
   - Whether tool call parameters match their definitions
   - Whether the final response matches expectations
5. Note: task execution requires an API key and will incur costs

##### Scenario C: Debug a Specific Tool (Zero API Cost)

1. Open the test file to debug, e.g. `tests/tools/read_file.test.ts`
2. Select **"🧪 Debug Current Test File"**
3. Set a breakpoint at the `execute()` entry of the corresponding tool source (e.g. `src/core/tools/read_file.ts`)
4. Press `F5` — when the breakpoint triggers, you can single-step through the complete tool logic
5. This is the most recommended approach: **zero API cost + rapid validation**

##### Scenario D: Debug Context Trimming Logic

1. Select **"🔧 One-Shot Task Debug"**
2. Set a breakpoint at the `trim()` method in `src/core/context/manager.ts`
3. Also set a breakpoint at the `addMessage()` method
4. After launching, observe the token estimates and trimming behavior each time a message is added
5. Use the debug console to run `messages.map(m => m.role)` to inspect message role distribution

##### Scenario E: Debug with Chrome DevTools

1. Select **"🌐 Chrome DevTools Remote Debug"**
2. Press `F5` to start
3. Open Chrome and go to `chrome://inspect`
4. Click "Open dedicated DevTools for Node"
5. In Sources panel → Filesystem → add the project folder
6. Navigate to TypeScript files under `src/`, click line numbers to set breakpoints
7. Enter commands in the REPL to trigger breakpoints

---

#### console.error Debug Log Templates

Paste the following code into the function you need to debug:

```typescript
// === Generic Debug Template ===
console.error('========================================');
console.error('[DEBUG] Function:', 'functionName');
console.error('[DEBUG] Params:', JSON.stringify(params, null, 2));
console.error('[DEBUG] Stack:', new Error().stack?.split('\n').slice(2, 6).join('\n'));
console.error('========================================');

// === Agent Loop Specific ===
console.error('[Loop] iteration: %d, messages: %d, token usage: %d',
  iteration, messages.length, currentUsage.totalTokens);

// === Tool Execution Specific ===
console.error('[Tool] %s called, args: %o', toolName, args);
console.error('[Tool] result success=%s, output length=%d',
  result.success, result.output?.length);

// === Provider Specific ===
console.error('[Provider] request → model=%s, messages=%d, tools=%d',
  options.model, messages.length, options.tools?.length ?? 0);

// === Context Management Specific ===
console.error('[Context] token estimate: %d / budget: %d (%.1f%%)',
  estimatedTokens, budget, (estimatedTokens / budget) * 100);
```

---

#### Common Debugging Issues Quick Reference

| Symptom | Likely Cause | Troubleshooting Steps |
|---|---|---|
| LLM returns empty response | Invalid API key or network unreachable | 1. `console.error` the API response status code 2. Check for exceptions thrown in `provider.ts` stream() |
| Tool call fails | Parameter format doesn't match schema | 1. Add `console.error` at `executor.ts` entry 2. Compare tool definition vs LLM-provided args |
| Context unexpectedly trimmed | Token estimate too high | 1. Add logs in `manager.ts` trim() 2. Check estimation ratio (currently 4 chars/token) |
| Streaming output stutters | Iterator not yielding correctly | 1. Add `console.error` in `provider.ts` for await loop 2. Check each chunk is yielded promptly |
| Slash command not working | Command parsing error | 1. Set breakpoint in `commands.ts` handleSlashCommand 2. Check the returned discriminated union type |
| Type errors | Type definition mismatch | Run `npm run typecheck` for complete error list |
| Build succeeds but behavior is wrong | Compiled output differs from source | 1. Inspect `dist/` output 2. Verify `.js` extension imports are correct |
| Breakpoints not hitting | Source Map not mapping correctly | 1. Confirm `tsconfig.json` has `"sourceMap": true` 2. Clear `dist/` and rebuild |
| Vitest debugging not working | vitest.mjs path issue | Ensure `${workspaceFolder}/node_modules/vitest/vitest.mjs` path is used |

---

#### Using Tests for Debugging

Writing or running tests is the most reliable way to verify tool behavior:

```bash
# Run a single test file for quick verification
npx vitest run tests/tools/read_file.test.ts

# Use --reporter=verbose for detailed output
npx vitest --reporter=verbose

# Use watch mode to auto-rerun tests on code changes
npx vitest

# Run only tests matching a name pattern
npx vitest run -t "reads an existing file"
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

### Verbose Output

```bash
npx vitest --reporter=verbose
```

### Test Structure

Tests are located in `tests/` and mirror the `src/` structure. The test framework is [Vitest](https://vitest.dev/), configured in `vitest.config.ts`.

Key characteristics:

- **No API key required**: Tool-level unit tests operate on the local filesystem and shell, not against any LLM.
- **Isolated filesystem**: Tests use temporary directories to avoid side effects.
- **Async tests**: Most tool tests are async since they interact with I/O.

### Writing Tests

Example test structure:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileTool } from '../../src/core/tools/read_file.js';

describe('read_file', () => {
  it('reads an existing file', async () => {
    const result = await readFileTool.execute({ path: 'package.json' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('"name": "codegrunt"');
  });

  it('returns error for non-existent file', async () => {
    const result = await readFileTool.execute({ path: 'nonexistent.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to read');
  });
});
```

---

## Architecture Overview

### High-Level Flow

```
User Input (CLI / REPL)
       │
       ▼
  ┌─────────────┐
  │  Agent Loop  │ ◄──── LLM Provider (streaming)
  │  (loop.ts)   │ ────► Tool Execution
  └──────┬──────┘
         │
    ┌────┴────┐
    │  Tools  │
    │ (6 impl)│
    └─────────┘
```

### Agent Loop (`src/core/agent/loop.ts`)

The agent loop is the heart of CodeGrunt. It follows a **ReAct** (Reasoning + Acting) pattern:

1. **System prompt** is constructed once per session (stable for prompt cache hits).
2. **User message** is appended with `[cwd]` and `[date]` prefix.
3. **Stream response** from the LLM — handles text deltas, reasoning deltas, and tool call deltas.
4. **If tool calls** are received, execute each tool and feed results back to the LLM.
5. **If text response** (finish_reason = "stop"), output to user and end.
6. **Loop** up to 30 iterations to handle multi-step tasks.

Key design decisions:

- **System prompt stability**: The system prompt is built once and never changes during a session. This maximizes prompt cache hit rates on DeepSeek (and other providers that support prompt caching).
- **Context management**: The `ContextManager` tracks token usage and trims old messages when the budget is exceeded, always preserving the system message and the most recent user message.
- **Streaming-first**: All LLM communication is streaming via `AsyncIterable<StreamChunk>`, enabling real-time output to the terminal.

### Tool System

Tools are the mechanism by which the LLM interacts with the user's environment. Each tool implements the `Tool` interface:

```typescript
interface Tool {
  definition: ToolDefinition;  // OpenAI-compatible function definition
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
```

The six built-in tools:

| Tool | Description |
|---|---|
| `read_file` | Read file contents (truncated at 30,000 chars) |
| `write_file` | Write content to a file (creates directories) |
| `edit_file` | Replace exact string in a file (string-match editing) |
| `execute_shell` | Run shell commands with timeout |
| `list_directory` | List directory tree with configurable depth |
| `search_files` | Search for text patterns in files |

**Safety**: Before destructive operations (`write_file`, `edit_file`, `execute_shell`), the executor shows a diff preview and asks for user confirmation.

### Context Management (`src/core/context/manager.ts`)

The `ContextManager` maintains the conversation history:

- **Token estimation**: Uses a simple 4:1 character-to-token ratio.
- **Trimming**: When the estimated token count exceeds the budget, oldest non-system messages are removed.
- **Budget**: Defaults to 90,000 tokens for chat models (128K context minus output room); 100,000 for reasoner models (1M context window).

### Provider System

All LLM backends implement the `LLMProvider` interface:

```typescript
interface LLMProvider {
  readonly id: string;
  stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk>;
}
```

The `StreamChunk` union type supports:

- `text_delta` — incremental text output
- `reasoning_delta` — chain-of-thought reasoning (displayed as "Thinking...")
- `tool_call_delta` — streaming tool call arguments
- `finish` — end-of-stream with finish reason

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
    // 1. Transform messages to your API format
    // 2. Make streaming API call
    // 3. Yield StreamChunk values as the response arrives
    // 4. Yield a finish chunk when done

    for await (const chunk of yourApiCall(messages, options)) {
      if (chunk.type === 'text') {
        yield { type: 'text_delta', text: chunk.content };
      }
      // ... handle other chunk types
    }

    yield { type: 'finish', finish_reason: 'stop' };
  }
}
```

### Step 3: Register the Provider

In `src/cli/index.ts` or through the configuration system:

```typescript
import { MyProvider } from './providers/myprovider/provider.js';

// In the action handler:
const provider = new MyProvider(config);
```

### Step 4: Add Configuration Support

Update `src/config.ts` to support your provider's configuration (API key env var, base URL, etc.).

### Provider Contract

Your provider must:

1. Accept `Message[]` in OpenAI-compatible format
2. Return an `AsyncIterable<StreamChunk>`
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
          param1: {
            type: 'string',
            description: 'Description of param1',
          },
        },
        required: ['param1'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // Your implementation
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

Add your tool to `src/core/tools/registry.ts`:

```typescript
import { myTool } from './my_tool.js';

const ALL_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  executeShellTool,
  listDirectoryTool,
  searchFilesTool,
  myTool,  // ← Add here
];
```

### Step 3: Add Safety Confirmation (if destructive)

If your tool modifies the filesystem, add confirmation logic in `src/core/tools/executor.ts` similar to `edit_file` and `write_file`.

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

CodeGrunt provides a set of slash commands available in the interactive REPL. These are implemented in `src/cli/commands.ts`.

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
| `/exit` | Exit the REPL |

---

## @-Reference Syntax

CodeGrunt supports `@`-references in the REPL and one-shot mode, implemented in `src/cli/at-resolver.ts`. This lets you reference files and URLs directly in your prompt.

### File References

```bash
# Reference a file — its content is inlined into the prompt
codegrunt "explain @src/core/agent/loop.ts"

# Reference multiple files
codegrunt "compare @src/config.ts and @src/types.ts"

# Reference with line numbers (if supported by the resolver)
codegrunt "fix the bug in @src/cli/index.ts:42-56"
```

### URL References

```bash
# Reference a URL — its content is fetched and inlined
codegrunt "summarize @https://example.com/docs/api"
```

### How It Works

When the input contains `@<path>` or `@<url>`, the `at-resolver.ts` module:

1. Detects `@` tokens in the input string
2. For file paths: reads the file content and replaces `@path` with the file content, prefixed by the filename
3. For URLs: fetches the URL content and inlines it
4. The expanded content is sent to the LLM as part of the user message

This is especially useful for providing context without manually copying file contents.

---

## First-Run Setup Wizard

When CodeGrunt is started for the first time without a configured API key, it runs the setup wizard (`src/cli/setup.ts`).

### What It Does

1. **Detects missing configuration** — checks if `DEEPSEEK_API_KEY` is set or `~/.codegrunt/config.json` exists
2. **Prompts for API key** — asks the user to enter their DeepSeek API key
3. **Model selection** — lets user choose from available DeepSeek models
4. **Saves configuration** — writes to `~/.codegrunt/config.json`
5. **Verifies the key** — makes a test API call to confirm the key works

### Skipping the Wizard

You can skip the wizard by pre-configuring:

```bash
export DEEPSEEK_API_KEY=sk-xxxxxxxx
# or create ~/.codegrunt/config.json manually
```

---

## Project Guide System

CodeGrunt automatically loads project-level guidance from `CODEGRUNT.md` or `CLAUDE.md` files in the project root, implemented in `src/core/context/project-guide.ts`.

### How It Works

1. On startup, CodeGrunt looks for `CODEGRUNT.md` or `CLAUDE.md` in the current working directory
2. If found, the file content is prepended to the system prompt
3. This allows each project to define custom instructions for the AI assistant

### Example `CODEGRUNT.md`

```markdown
# CODEGRUNT.md

This file provides guidance to CodeGrunt when working with this project.

## Commands
npm run test        # run tests
npm run lint        # run linter
npm run build       # compile

## Conventions
- Use functional components in React
- Prefer named exports over default exports
- Write tests for all new features
```

### Priority

If both `CODEGRUNT.md` and `CLAUDE.md` exist, `CODEGRUNT.md` takes precedence.

---

## Configuration System

### Configuration Sources (in priority order)

1. **Environment variables** (highest priority)
2. **`~/.codegrunt/config.json`** (user config file)
3. **Hardcoded defaults** (lowest priority)

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key | — |
| `CODEGRUNT_MODEL` | Model ID | `deepseek-v4-pro` |
| `CODEGRUNT_PROVIDER` | Provider ID | `deepseek` |
| `CODEGRUNT_MAX_TOKENS` | Max tokens per response | `8192` |
| `CODEGRUNT_TEMPERATURE` | Temperature (0-2) | `0.2` |
| `CODEGRUNT_BASE_URL` | API base URL | `https://api.deepseek.com` |
| `CODEGRUNT_REASONING_EFFORT` | R1 reasoning effort: `low` \| `medium` \| `high` | `medium` |
| `CODEGRUNT_TOP_P` | Nucleus sampling (0-1) | `1` |
| `CODEGRUNT_FREQUENCY_PENALTY` | Repetition penalty (-2 to 2) | `0` |
| `CODEGRUNT_PRESENCE_PENALTY` | Topic diversity penalty (-2 to 2) | `0` |

### Config File Location

`~/.codegrunt/config.json`

```json
{
  "apiKey": "sk-...",
  "model": "deepseek-v4-pro",
  "maxTokens": 8192,
  "temperature": 0.2,
  "provider": "deepseek",
  "baseURL": "https://api.deepseek.com",
  "reasoningEffort": "medium",
  "topP": 1,
  "frequencyPenalty": 0,
  "presencePenalty": 0
}
```

### How Configuration is Loaded

See `src/config.ts`:

```typescript
export async function loadConfig(): Promise<CodeGruntConfig> {
  const fileConfig = await loadConfigFile();  // reads ~/.codegrunt/config.json

  return {
    provider: process.env.CODEGRUNT_PROVIDER ?? fileConfig.provider ?? DEFAULTS.provider,
    model: process.env.CODEGRUNT_MODEL ?? fileConfig.model ?? DEFAULTS.model,
    maxTokens: process.env.CODEGRUNT_MAX_TOKENS
      ? parseInt(process.env.CODEGRUNT_MAX_TOKENS, 10)
      : (fileConfig.maxTokens ?? DEFAULTS.maxTokens),
    temperature: process.env.CODEGRUNT_TEMPERATURE
      ? parseFloat(process.env.CODEGRUNT_TEMPERATURE)
      : (fileConfig.temperature ?? DEFAULTS.temperature),
    apiKey: process.env.DEEPSEEK_API_KEY ?? fileConfig.apiKey ?? '',
    baseURL: process.env.CODEGRUNT_BASE_URL ?? fileConfig.baseURL ?? DEFAULTS.baseURL,
    reasoningEffort: (process.env.CODEGRUNT_REASONING_EFFORT as 'low' | 'medium' | 'high')
      ?? fileConfig.reasoningEffort
      ?? DEFAULTS.reasoningEffort,
    topP: process.env.CODEGRUNT_TOP_P
      ? parseFloat(process.env.CODEGRUNT_TOP_P)
      : (fileConfig.topP ?? DEFAULTS.topP),
    frequencyPenalty: process.env.CODEGRUNT_FREQUENCY_PENALTY
      ? parseFloat(process.env.CODEGRUNT_FREQUENCY_PENALTY)
      : (fileConfig.frequencyPenalty ?? DEFAULTS.frequencyPenalty),
    presencePenalty: process.env.CODEGRUNT_PRESENCE_PENALTY
      ? parseFloat(process.env.CODEGRUNT_PRESENCE_PENALTY)
      : (fileConfig.presencePenalty ?? DEFAULTS.presencePenalty),
  };
}
```

---

## Release Process

### Creating a Release

1. **Update version** in `package.json`:
   ```bash
   npm version patch  # or minor, or major
   ```

2. **Build**:
   ```bash
   npm run build
   ```

3. **Run tests**:
   ```bash
   npm test
   ```

4. **Publish to npm**:
   ```bash
   npm publish
   ```

5. **Tag in Git**:
   ```bash
   git tag v$(node -p "require('./package.json').version")
   git push origin --tags
   ```

### Version Convention

- **Patch** (0.1.0 → 0.1.1): Bug fixes, small improvements
- **Minor** (0.1.0 → 0.2.0): New features, backward-compatible
- **Major** (0.x → 1.0.0): Breaking changes, stable release

---

## Troubleshooting

### Build Errors

| Symptom | Likely Cause | Solution |
|---|---|---|
| `Cannot find module 'x'` | Missing dependency | `npm install` |
| `Type error TS2304: Cannot find name` | Missing type | `npm install -D @types/node` |
| `Cannot use import statement outside a module` | Missing `"type": "module"` | Check `package.json` has `"type": "module"` |
| Build succeeds but runtime fails | Module resolution mismatch | Ensure imports use `.js` extension |

### Runtime Errors

| Symptom | Likely Cause | Solution |
|---|---|---|
| `No API key configured` | Missing API key | Set `DEEPSEEK_API_KEY` env var or run setup |
| `ECONNREFUSED` | Network/proxy issue | Check network, set `CODEGRUNT_BASE_URL` |
| `ETIMEDOUT` | Slow API response | Increase timeout or check API status |
| Tool execution hangs | Shell command stuck | Check for interactive prompts in commands |

### Development Tips

- **Use `console.error()`** for debug output — it goes to stderr and won't interfere with tool output parsing.
- **Check the `dist/` output** if you're unsure about compilation: `cat dist/core/tools/read_file.js`
- **Run `npm run typecheck`** frequently to catch type errors early.
- **Use `--noEmit`** during development to avoid cluttering `dist/` with incomplete builds.

---

## Contributing

See [CONTRIBUTING.md](./contributing.md) for detailed contribution guidelines.

Quick checklist:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run type check: `npm run typecheck`
6. Commit with conventional commit message: `feat: add xyz`
7. Push and open a Pull Request

---

## License

MIT © CodeGrunt Contributors
