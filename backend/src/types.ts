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

export type RunInput = {
  query: string;
  strategy: SearchStrategy;
  model: string;
  reasoning: boolean;
};

export type MessageEvent = {
  event: 'message';
  data: {
    id: string;
    content: string;
    reasoningContent: string;
  };
};

export type SearchType = Exclude<SearchStrategy, 'agentic'>;

export type ToolInputEvent = {
  event: 'tool_input';
  data: {
    id: string;
    name: string;
    input: {
      type: SearchType;
      query: string;
      topK?: number;
    };
  };
};

export type ToolOutputEvent = {
  event: 'tool_output';
  data: {
    id: string;
    output: string;
  };
};

export type RunEvent = MessageEvent | ToolInputEvent | ToolOutputEvent;

export type Thread = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export const RunStatus = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
} as const;

export type RunStatus = typeof RunStatus[keyof typeof RunStatus];

export type Run = {
  id: string;
  thread_id: string;
  start_checkpoint_id: string | null;
  end_checkpoint_id: string | null;
  status: RunStatus;
  input: RunInput;
  events: RunEvent[];
  error: string | null;
  created_at: string;
  updated_at: string;
};
