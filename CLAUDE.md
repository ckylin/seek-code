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

CodeGrunt is a terminal-native agentic coding assistant. The intended structure:

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

Config file is created on first run via the setup wizard (`src/cli/setup.ts`).
