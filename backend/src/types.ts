import { Document } from '@langchain/core/documents';

export type File = {
  path: string;
  relativePath: string;
  isDirectory: boolean;
  depth: number;
};

export interface EmbeddingDocumentMetadata {
  path: string;
  chunkIndex: number;
  totalChunks: number;
}

export type EmbeddingDocument = {
  id: string;
} & Document<EmbeddingDocumentMetadata>;

export type DocumentSearchResult = EmbeddingDocument & {
  score: number;
};

export enum LLMProvider {
  OpenRouter = 'openrouter',
  Ollama = 'ollama',
}

export type LLM = {
  provider: LLMProvider;
  model: string;
  name: string;
  isDefault?: boolean;
};

export const SearchStrategy = {
  AGENTIC: 'agentic',
  KEYWORD: 'keyword',
  SEMANTIC: 'semantic',
  HYBRID: 'hybrid',
} as const;

export type SearchStrategy =
  (typeof SearchStrategy)[keyof typeof SearchStrategy];
