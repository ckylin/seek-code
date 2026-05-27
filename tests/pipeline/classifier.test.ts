// ── Classifier Unit Tests ──────────────────────────────────────────────────
// Tests for is_code_request() — the request classifier that determines
// whether a user input is a code-writing task.
//
// Covers: positive cases (code requests), negative cases (non-code), edge cases.

import { describe, it, expect } from 'vitest';
import { is_code_request } from '../../src/core/pipeline/classifier.js';

// ── Positive cases: code-writing requests ─────────────────────────────────

describe('is_code_request — positive (code tasks)', () => {
  it('write a function — English', () => {
    expect(is_code_request('write a function that sorts an array')).toBe(true);
  });

  it('implement a class — English', () => {
    expect(is_code_request('implement a class for user authentication')).toBe(true);
  });

  it('refactor existing code', () => {
    expect(is_code_request('refactor the database module to use connection pooling')).toBe(true);
  });

  it('fix a bug', () => {
    expect(is_code_request('fix the bug in the login handler')).toBe(true);
  });

  it('write tests', () => {
    expect(is_code_request('write unit tests for the billing module')).toBe(true);
  });

  it('write a script', () => {
    expect(is_code_request('write a Python script to clean up logs')).toBe(true);
  });

  it('create a file', () => {
    expect(is_code_request('create a file called config.ts with the settings')).toBe(true);
  });

  it('build a component', () => {
    expect(is_code_request('build a React component for the navbar')).toBe(true);
  });

  it('add a feature', () => {
    expect(is_code_request('add a search feature to the homepage')).toBe(true);
  });

  it('Chinese: 写一个函数', () => {
    expect(is_code_request('请帮我写一个函数来计算两个数的和')).toBe(true);
  });

  it('Chinese: 写代码', () => {
    expect(is_code_request('帮我写代码实现用户登录')).toBe(true);
  });

  it('Chinese: 重构', () => {
    expect(is_code_request('重构这个模块的代码结构')).toBe(true);
  });

  it('Chinese: 修复bug', () => {
    expect(is_code_request('帮我修复这个bug')).toBe(true);
  });

  it('Chinese: 写测试', () => {
    expect(is_code_request('为这个模块写测试用例')).toBe(true);
  });

  it('generate code', () => {
    expect(is_code_request('generate code for the API endpoint')).toBe(true);
  });

  it('debug this', () => {
    expect(is_code_request('debug this TypeScript error in the build')).toBe(true);
  });

  it('install package with code change', () => {
    expect(is_code_request('install the express package and set up the server file')).toBe(true);
  });

  it('复合请求：既是问题又是代码请求', () => {
    expect(is_code_request('这个函数有bug，帮我修复一下')).toBe(true);
  });
});

// ── Negative cases: non-code requests ─────────────────────────────────────

describe('is_code_request — negative (non-code tasks)', () => {
  it('greeting: hello', () => {
    expect(is_code_request('hello')).toBe(false);
  });

  it('greeting: 你好', () => {
    expect(is_code_request('你好')).toBe(false);
  });

  it('explain a concept', () => {
    expect(is_code_request('explain how closures work in JavaScript')).toBe(false);
  });

  it('what is something', () => {
    expect(is_code_request('what is the difference between let and var')).toBe(false);
  });

  it('how does something work', () => {
    expect(is_code_request('how does the event loop work in Node.js')).toBe(false);
  });

  it('tell me about something', () => {
    expect(is_code_request('tell me about the history of TypeScript')).toBe(false);
  });

  it('question ending with ?', () => {
    expect(is_code_request('what is the capital of France?')).toBe(false);
  });

  it('weather question', () => {
    expect(is_code_request('what is the weather like today')).toBe(false);
  });

  it('thank you', () => {
    expect(is_code_request('thank you for your help')).toBe(false);
  });

  it('goodbye', () => {
    expect(is_code_request('goodbye, see you later')).toBe(false);
  });

  it('Chinese: 你好', () => {
    expect(is_code_request('你好，今天怎么样')).toBe(false);
  });

  it('Chinese: 解释概念', () => {
    expect(is_code_request('解释一下什么是闭包')).toBe(false);
  });

  it('Chinese: 谢谢', () => {
    expect(is_code_request('谢谢你的帮助')).toBe(false);
  });

  it('Chinese: 区别问题', () => {
    expect(is_code_request('let和var有什么区别？')).toBe(false);
  });

  it('opinion question', () => {
    expect(is_code_request('do you think TypeScript is better than JavaScript')).toBe(false);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────

describe('is_code_request — edge cases', () => {
  it('empty string', () => {
    expect(is_code_request('')).toBe(false);
  });

  it('whitespace only', () => {
    expect(is_code_request('   ')).toBe(false);
  });

  it('very short input', () => {
    expect(is_code_request('ok')).toBe(false);
  });

  it('single word that could be code or not', () => {
    expect(is_code_request('deploy')).toBe(true); // "deploy" is a code keyword
  });

  it('null/undefined-like (should handle gracefully)', () => {
    expect(is_code_request(null as unknown as string)).toBe(false);
    expect(is_code_request(undefined as unknown as string)).toBe(false);
  });
});
