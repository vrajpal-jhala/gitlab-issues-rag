import { resolve, join, dirname } from 'node:path';
import { LLM, LLMProvider } from '../types.js';

const dataPath = resolve(
  dirname(new URL(import.meta.url).pathname),
  '../../../.data',
);
const documentsPath = join(dataPath, 'documents');
const cachePath = join(dataPath, 'cache');

export const config = {
  documentsPath,
  vectors: {
    url: `file:${join(cachePath, 'vector', 'vector.sqlite')}`,
    table: 'documents',
    column: 'vector',
  },
  database: {
    url: `${join(dataPath, 'database.sqlite')}`,
  },
  embeddings: {
    model: 'nomic-embed-text',
    baseUrl: 'http://10.40.0.20:11434',
    batchSize: 100,
    dimension: 768,
  },
  indexing: {
    path: cachePath,
    chunkSize: 250,
    chunkOverlap: 0,
    bm25_k1: 1.5,
    bm25_b: 0.75,
  },
  search: {
    rrfK: 60,
  },
  rerank: {
    model: 'Xenova/ms-marco-TinyBERT-L-2-v2', // local only (huggingface)
  },
  classification: {
    model: 'qwen3.5:latest',
    provider: LLMProvider.Ollama,
  },
  generation: {
    temperature: 0.1,
    provider: {
      [LLMProvider.OpenRouter]: {
        apiKey: process.env.OPENROUTER_API_KEY || '',
      },
      [LLMProvider.Ollama]: {
        url: 'http://10.40.0.20:11434',
      },
    },
  },
};

export const llms: LLM[] = [
  {
    provider: LLMProvider.OpenRouter,
    name: 'GPT 4.1 Mini',
    model: 'openai/gpt-4.1-mini',
  },
  {
    provider: LLMProvider.OpenRouter,
    name: 'Sonnet 4.6',
    model: 'anthropic/claude-4.6-sonnet',
  },
  {
    provider: LLMProvider.Ollama,
    name: 'Qwen 3.6 (35B)',
    model: 'qwen3.6:35b',
  },
  {
    provider: LLMProvider.Ollama,
    name: 'Qwen 3.5 (9B)',
    model: 'qwen3.5:latest',
    isDefault: true,
  },
  {
    provider: LLMProvider.Ollama,
    name: 'Gemma 4 (31B)',
    model: 'gemma4:31b',
  },
];
