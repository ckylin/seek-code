# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # dev mode with watch (tsx)
npm run build      # compile TypeScript to dist/
npm run typecheck  # type check only, no emit
npm test           # run vitest test suite
npm start          # run compiled dist/cli/index.js

# Run a single test file
npx vitest run tests/tools/read_file.test.ts
```

## Architecture

CodeGrunt is a terminal-native agentic coding assistant built on a ReAct (reason + act) loop.

- `src/cli/` — entry point, REPL loop, argument parsing, slash commands, skills, @-reference resolver
- `src/core/agent/` — agentic ReAct loop and task planning
- `src/core/tools/` — 6 built-in tools: file read/write/edit, shell execution, directory listing, search
- `src/core/context/` — context window management (token budget, trimming) and project guide loading
- `src/providers/` — LLM provider adapters implementing a shared `LLMProvider` interface
- `src/utils/` — shared utilities (display, confirm, billing, markdown rendering, interrupt)

## Agent Loop (`src/core/agent/loop.ts`)

The loop runs up to 30 iterations. Each iteration streams from the LLM and either executes tool calls (feeding results back) or ends on a `stop` finish reason.

**System prompt stability**: the system prompt is built once per session and never mutated, to maximise DeepSeek prompt cache hits. For R1 reasoner models, the system prompt is embedded in the first user message (R1 rejects the `system` role).

**Model branching**: `isReasonerModel()` detects R1 variants; `supportsReasoning()` also matches V4/Pro models that emit `reasoning_content`. Context budgets differ: 100k tokens for reasoning models, 90k for chat models.

## Provider System

New LLM backends implement the `LLMProvider` interface defined in `src/types.ts`:

```typescript
interface LLMProvider {
  readonly id: string;
  stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk>;
}
```

`StreamChunk` is a discriminated union: `text_delta`, `reasoning_delta`, `tool_call_delta`, `finish`. The DeepSeek provider (`src/providers/deepseek/`) wraps the `openai` npm package pointed at DeepSeek's API base URL.

## Tool Confirmation Flow

Destructive tools (`write_file`, `edit_file`, `execute_shell`) go through `src/core/tools/executor.ts`, which calls `confirmEdit()` in `src/utils/confirm.ts` to show a diff and prompt the user. Choosing "Yes for all" sets a module-level `yesAllSessionActive` flag that bypasses further prompts for the rest of that user turn. `resetYesAll()` is called at the start of each new turn.

## Skills System

Skills are Markdown files with YAML frontmatter (`name`, `description`, `system`, and body content). They are loaded from `<cwd>/.codegrunt/skills/` (project) and `~/.codegrunt/skills/` (global), and installed from `.zip` archives via `/skills install`. A skill can define a `system` field to completely replace the default coding-assistant identity for its session.

## UI / Input (`src/cli/input.ts`)

Raw-mode terminal input with a bottom border + hint line. The render loop writes dropdown rows → input line → border → hint, then repositions the cursor using ANSI escape sequences. The accent color throughout is `#4A90D9`. Both the inline dropdown and `selectFromList` use `❯` as the selected-item indicator.

## Configuration

Runtime config via env vars or `~/.codegrunt/config.json`:

- `DEEPSEEK_API_KEY` — required for the default DeepSeek provider
- `CODEGRUNT_MODEL` — model ID (default: `deepseek-v4-pro`)
- `CODEGRUNT_PROVIDER` — provider ID (default: `deepseek`)
- `CODEGRUNT_MAX_TOKENS` — max tokens per response (default: `8192`)
- `CODEGRUNT_TEMPERATURE` — response temperature (default: `0.2`)
- `CODEGRUNT_BASE_URL` — API base URL (default: `https://api.deepseek.com`)
- `CODEGRUNT_REASONING_EFFORT` — R1 reasoning effort: `low` | `medium` | `high`
- `CODEGRUNT_TOP_P` — nucleus sampling (default: `1`)
- `CODEGRUNT_FREQUENCY_PENALTY` — repetition penalty (default: `0`)
- `CODEGRUNT_PRESENCE_PENALTY` — topic diversity penalty (default: `0`)

Config file is created on first run via the setup wizard (`src/cli/setup.ts`). Env vars take precedence over the config file.
