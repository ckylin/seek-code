import OpenAI from 'openai';
import type { SeekCodeConfig } from '../../types.js';

export function createOpenAIClient(config: SeekCodeConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}
