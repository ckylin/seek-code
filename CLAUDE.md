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

- `src/cli/` — entry point, REPL loop, argument parsing
- `src/core/agent/` — agentic loop and task planning
- `src/core/tools/` — file read/write, shell execution, search tool implementations
- `src/core/context/` — codebase indexing and context window management
- `src/providers/` — LLM provider adapters implementing a shared `LLMProvider` interface
- `src/utils/` — shared utilities

## Provider System

New LLM backends implement the `LLMProvider` interface:

```typescript
interface LLMProvider {
  readonly id: string;
  stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk>;
}
```

Providers are registered in `seekcode.config.ts` via `defineConfig({ providers: [...] })`.

## Configuration

Runtime config via env vars or `~/.seekcode/config.json`:

- `DEEPSEEK_API_KEY` — required for the default DeepSeek provider
- `SEEKCODE_MODEL` — model ID (default: `deepseek-v4-pro`)
- `SEEKCODE_PROVIDER` — provider ID (default: `deepseek`)
- `SEEKCODE_MAX_TOKENS` — max tokens per response (default: `8192`)
