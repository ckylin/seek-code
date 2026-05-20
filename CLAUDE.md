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

Seek Code is a terminal-native agentic coding assistant. The intended structure:

- `src/cli/` — entry point, REPL loop, argument parsing, slash commands, skills, @-reference resolver
- `src/core/agent/` — agentic ReAct loop and task planning
- `src/core/tools/` — 6 built-in tools: file read/write/edit, shell execution, directory listing, search
- `src/core/context/` — context window management (token budget, trimming) and project guide loading
- `src/providers/` — LLM provider adapters implementing a shared `LLMProvider` interface
- `src/utils/` — shared utilities (display, confirm, billing, markdown rendering, interrupt)

## Provider System

New LLM backends implement the `LLMProvider` interface defined in `src/types.ts`:

```typescript
interface LLMProvider {
  readonly id: string;
  stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk>;
}
```

The project ships with the **DeepSeek** provider (`src/providers/deepseek/`), which wraps the `openai` npm package pointed at DeepSeek's API base URL.

## Configuration

Runtime config via env vars or `~/.seekcode/config.json`:

- `DEEPSEEK_API_KEY` — required for the default DeepSeek provider
- `SEEKCODE_MODEL` — model ID (default: `deepseek-v4-pro`)
- `SEEKCODE_PROVIDER` — provider ID (default: `deepseek`)
- `SEEKCODE_MAX_TOKENS` — max tokens per response (default: `8192`)
- `SEEKCODE_TEMPERATURE` — response temperature (default: `0.2`)
- `SEEKCODE_BASE_URL` — API base URL (default: `https://api.deepseek.com`)
- `SEEKCODE_REASONING_EFFORT` — R1 reasoning effort: `low` | `medium` | `high`
- `SEEKCODE_TOP_P` — nucleus sampling (default: `1`)
- `SEEKCODE_FREQUENCY_PENALTY` — repetition penalty (default: `0`)
- `SEEKCODE_PRESENCE_PENALTY` — topic diversity penalty (default: `0`)

Config file is created on first run via the setup wizard (`src/cli/setup.ts`).
