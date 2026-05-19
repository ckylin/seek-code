# SEEKCODE.md — Developer Guide

## Build & Dev Commands

```bash
# Development (watch mode, auto-reload on changes)
npm run dev

# TypeScript compilation to dist/
npm run build

# Type-check only (no emit)
npm run typecheck

# Full test suite
npm test

# Single test file
npx vitest run tests/tools/read_file.test.ts

# Run compiled output
npm start

# Global link for local CLI testing
npm link
```

**Engine requirement**: Node.js >= 18.  
**Module system**: ESM (`"type": "module"`).  
**Compiler target**: ES2022, bundled module resolution via `tsx` (dev) / `tsc` (build).

---

## Architecture

### Entry Point & CLI Layer (`src/cli/`)

```
index.ts  →  Commander.js program
  ├─ 0 args  →  startRepl()
  ├─ 1 arg   →  runAgentLoop() one-shot
  ├─ "update" subcommand  →  runUpdate()
  └─ "skills" subcommand  →  install / remove / list skills
```

`index.ts` is the binary entry. It loads config, initializes the DeepSeek provider, and branches into REPL, one-shot, update check, or skill management. One-shot uses a different context budget (`CONTEXT_BUDGET` for reasoner models vs `CHAT_CONTEXT_BUDGET` for chat models).

**REPL** (`repl.ts`, `input.ts`) uses Node.js `readline` with:
- Tab completion for file paths and slash commands
- `@`-reference auto-completion (files/directories)
- Input tuple detection (parenthesized multi-line mode)
- Session usage display in the prompt line

**`at-resolver.ts`** — Parses `@file.ts`, `@src/`, `@https://...` tokens from user input. Resolves them to content (reads files, lists directories up to 20 entries, fetches URLs) and appends formatted attachments to the message body. Directory scanning skips `node_modules`, `.git`, `dist`, `.next`, `__pycache__`, `.cache`.

**`commands.ts`** — Slash command handler. Returns discriminated unions: `handled`, `clear`, `config_changed`, `model_changed`, `skill_run`, `exit`, `skills_reload`, or `not_a_command`. Commands include `/init`, `/model`, `/compact`, `/clear`, `/config`, `/cost`, `/balance`, `/token`, `/reasoning`, `/effort`, `/review`, `/skills`, `/exit`, and skill execution via `/skill-name`.

**`skills.ts`** — Loads user-defined skills from `~/.seekcode/skills/` (global) and `.seekcode/skills/` (project-local). Each skill is a `.md` file or a directory with `skill.md` containing frontmatter (`name`, `description`, `system`) and a prompt template body. Supports installing skills from `.zip` files. Skills appear in tab completion and the `/help` menu.

**`setup.ts`** — Interactive first-run wizard: collects API key, model selection (lists DeepSeek models), token limit, reasoning effort. Writes to `~/.seekcode/config.json`.

**`update.ts`** — Checks npm registry for new versions and upgrades the global installation via `npm install -g seekcode@latest`.

### Agent Loop (`src/core/agent/loop.ts`)

Implements a **ReAct (Reasoning + Acting)** loop:

1. Send system prompt + conversation history + user task to the LLM
2. Stream response, detecting tool calls (function calling via OpenAI-compatible API)
3. Execute tool via the ToolExecutor
4. Append tool result as a message, loop back to step 1
5. Stop when the model emits a final text response (no tool call)

Tracks session token usage (`addUsage`, `getSessionUsage`, `resetSessionUsage`) for `/cost` reporting.

### Context Manager (`src/core/context/manager.ts`)

Manages conversation message array with a **token budget**. When the budget is exceeded, it truncates oldest messages (preserving system prompt). Two budget constants exist in `config.ts`:
- `CONTEXT_BUDGET` — for reasoner models (larger)
- `CHAT_CONTEXT_BUDGET` — for standard chat models (smaller)

**`project-guide.ts`** — Scans for `SEEKCODE.md` or `CLAUDE.md` in the working directory and injects it into the system prompt as codebase-level context.

### Tool System (`src/core/tools/`)

Six built-in tools:
| Tool | File | Destructive? |
|---|---|---|
| `read_file` | `read_file.ts` | No |
| `write_file` | `write_file.ts` | **Yes** — diff preview + confirm |
| `edit_file` | `edit_file.ts` | **Yes** — diff preview + confirm |
| `execute_shell` | `execute_shell.ts` | **Yes** — confirm |
| `list_directory` | `list_directory.ts` | No |
| `search_files` | `search_files.ts` | No |

**`registry.ts`** — Tool definitions (name, description, JSON Schema parameters) mapped to implementations. This is what gets sent to the LLM as available functions.

**`executor.ts`** — Dispatches tool calls. For destructive operations, computes a diff (using the `diff` npm package) and calls `confirm()` from `utils/confirm.ts` before applying.

### Provider System (`src/providers/`)

Providers implement the `LLMProvider` interface defined in `types.ts`:

```typescript
interface LLMProvider {
  readonly id: string;
  stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk>;
}
```

**DeepSeek provider** (`deepseek/provider.ts`, `deepseek/client.ts`) wraps the `openai` npm package pointed at DeepSeek's API base URL. It handles:
- Stream mode with tool call delta accumulation
- Reasoning content extraction (for reasoner models)
- Token usage tracking per request

### Utilities (`src/utils/`)

- **`billing.ts`** — Fetches account balance/usage from DeepSeek API, formats cost display with USD/CNY dual currency
- **`confirm.ts`** — Interactive yes/no prompt for destructive operations with diff preview
- **`display.ts`** — Markdown rendering in terminal, error formatting, diff display
- **`interrupt.ts`** — Creates `AbortController` for Ctrl+C handling in both REPL and one-shot modes
- **`markdown.ts`** — Strips or renders Markdown in terminal output

---

## Key Patterns & Conventions

### Discriminated Union Returns

Several modules (commands, input, tool executor) return tagged unions rather than throwing. Example from `commands.ts`:
```typescript
type SlashCommandResult =
  | { type: 'handled' }
  | { type: 'clear' }
  | { type: 'config_changed'; config: SeekCodeConfig }
  | { type: 'model_changed'; config: SeekCodeConfig }
  | { type: 'exit' }
  | { type: 'skill_run'; prompt: string; system?: string }
  | { type: 'skills_reload' }
  | { type: 'not_a_command' };
```
This keeps control flow at the call site explicit.

### Config is Passed, Not Global

`SeekCodeConfig` is loaded once in `index.ts` and threaded through function arguments. Nothing imports config globally. The exception is `config.ts` which exports constants (`CONTEXT_BUDGET`, `CHAT_CONTEXT_BUDGET`) and predicate functions (`isReasonerModel`).

### Provider-Agnostic Agent Loop

The agent loop (`runAgentLoop`) takes an `LLMProvider` interface, not a concrete DeepSeek instance. Adding a new provider requires only implementing `LLMProvider` and wiring it into `index.ts`.

### `@`-Reference Resolution Happens Pre-LLM

`resolveAtReferences()` runs on raw user input before messages are constructed. References are stripped from the visible prompt text and appended as formatted blocks at the bottom of the message. This means the LLM sees the full content but the user's prompt remains readable.

### Destructive Operations Require Double Confirmation

Write/edit/shell tools compute a diff or display the command, call `confirm()`, and only proceed on explicit "yes". The agent loop has no ability to bypass this — confirmation is inside the tool executor, not the agent.

### Model Selection Affects Budget and Behavior

`isReasonerModel()` in `config.ts` checks the model ID. Reasoner models get a larger context budget and support an `effort` parameter (controlled via `/reasoning` / `/effort` commands). This distinction flows through context manager initialization and provider request options.

---

## Configuration

### Environment Variables

| Variable | Effect | Required |
|---|---|---|
| `DEEPSEEK_API_KEY` | API key for DeepSeek provider | Yes |
| `SEEKCODE_MODEL` | Override default model ID | No |
| `SEEKCODE_PROVIDER` | Override provider ID | No |
| `SEEKCODE_MAX_TOKENS` | Max tokens per response | No |
| `SEEKCODE_TEMPERATURE` | Response temperature (0-2) | No |
| `SEEKCODE_BASE_URL` | Custom API base URL | No |
| `SEEKCODE_REASONING_EFFORT` | R1 reasoning effort: `low` \| `medium` \| `high` | No |
| `SEEKCODE_TOP_P` | Nucleus sampling (0-1) | No |
| `SEEKCODE_FREQUENCY_PENALTY` | Repetition penalty (-2 to 2) | No |
| `SEEKCODE_PRESENCE_PENALTY` | Topic diversity penalty (-2 to 2) | No |

### Config File

`~/.seekcode/config.json` — created by the setup wizard on first run. Stores:
```json
{
  "apiKey": "sk-...",
  "model": "deepseek-v4-pro",
  "provider": "deepseek",
  "maxTokens": 8192,
  "temperature": 0.2,
  "reasoningEffort": "medium",
  "topP": 1,
  "frequencyPenalty": 0,
  "presencePenalty": 0
}
```

### Project Guide Files

At startup, the context manager scans the working directory for `SEEKCODE.md` (preferred) or `CLAUDE.md` (fallback). If found, the file content is prepended to the system prompt to give the LLM project-specific context.

### Skills Directory

`~/.seekcode/skills/` (global) and `.seekcode/skills/` (project-local) — each skill is a `.md` file with YAML frontmatter (`name`, `description`, `system`) and a Markdown body, or a directory containing `skill.md`. Install new skills via `seekcode skills add -f <file.zip>`. Skills appear as slash commands in the REPL.
