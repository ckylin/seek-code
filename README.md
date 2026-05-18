# Seek Code

> An AI-powered CLI coding assistant for the terminal — built on DeepSeek, extensible to any LLM.

[![npm version](https://img.shields.io/npm/v/seekcode.svg)](https://www.npmjs.com/package/seekcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

Seek Code is an open-source, terminal-native AI coding assistant. It reads your codebase, understands context, and helps you write, refactor, debug, and ship code — all from the command line.

---

## Features

- **Agentic coding** — Seek Code can read files, edit code, run commands, and iterate autonomously on multi-step tasks
- **Codebase-aware** — understands your project structure, imports, and conventions before acting
- **Multi-model support** — ships with DeepSeek V4 Pro; designed to plug in Doubao, Kimi, and other providers with minimal config
- **Tool use** — file read/write, shell execution, search, and more via a structured tool layer
- **Streaming output** — real-time token streaming for a responsive terminal experience
- **Extensible provider system** — add new LLM backends by implementing a single interface

---

## Quickstart

```bash
npm install -g seekcode

# Set your API key
export DEEPSEEK_API_KEY=your_key_here

# Start an interactive session
seekcode

# One-shot task
seekcode "refactor the auth module to use async/await"
```

---

## Installation

**Requirements:** Node.js 18+

```bash
# npm
npm install -g seekcode

# pnpm
pnpm add -g seekcode

# Build from source
git clone https://github.com/your-org/seekcode.git
cd seekcode
npm install
npm run build
npm link
```

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

### Config file

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "maxTokens": 8192,
  "temperature": 0.2
}
```

---

## Supported Models & Providers

| Provider | Models | Status |
|---|---|---|
| [DeepSeek](https://platform.deepseek.com/) | `deepseek-v4-pro`, `deepseek-v3` | ✅ Supported |
| [Doubao (豆包)](https://www.volcengine.com/product/doubao) | `doubao-pro-*` | 🔜 Planned |
| [Kimi](https://platform.moonshot.cn/) | `moonshot-v1-*` | 🔜 Planned |
| OpenAI-compatible | Any OpenAI-format endpoint | 🔜 Planned |

### Adding a provider

Implement the `LLMProvider` interface and register it:

```typescript
import { LLMProvider, Message, StreamChunk } from 'seekcode/core';

export class MyProvider implements LLMProvider {
  readonly id = 'my-provider';

  async *stream(messages: Message[], options: RequestOptions): AsyncIterable<StreamChunk> {
    // your implementation
  }
}
```

```typescript
// seekcode.config.ts
import { defineConfig } from 'seekcode';
import { MyProvider } from './my-provider';

export default defineConfig({
  providers: [new MyProvider()],
  defaultProvider: 'my-provider',
});
```

---

## Architecture

```
seekcode/
├── src/
│   ├── cli/          # Entry point, REPL, argument parsing
│   ├── core/
│   │   ├── agent/    # Agentic loop, task planning
│   │   ├── tools/    # File, shell, search tool implementations
│   │   └── context/  # Codebase indexing, context window management
│   ├── providers/    # LLM provider adapters
│   │   ├── deepseek/
│   │   ├── doubao/   # (planned)
│   │   └── kimi/     # (planned)
│   └── utils/        # Shared utilities
├── tests/
└── package.json
```

---

## Development

```bash
git clone https://github.com/your-org/seekcode.git
cd seekcode
npm install

# Run in dev mode (watch)
npm run dev

# Type check
npm run typecheck

# Run tests
npm test

# Build
npm run build
```

---

## Roadmap

- [ ] Core agentic loop with tool use
- [ ] DeepSeek V4 Pro provider
- [ ] File read/write/edit tools
- [ ] Shell execution tool
- [ ] Codebase context indexing
- [ ] Interactive REPL mode
- [ ] Doubao provider
- [ ] Kimi provider
- [ ] OpenAI-compatible provider
- [ ] MCP (Model Context Protocol) support
- [ ] VS Code extension

---

## Contributing

Contributions are welcome. Please open an issue before submitting a large PR so we can align on direction.

```bash
# Fork, clone, then:
git checkout -b feat/your-feature
npm test
git commit -m "feat: your feature"
git push origin feat/your-feature
# Open a PR
```

---

## License

MIT © Seek Code Contributors
