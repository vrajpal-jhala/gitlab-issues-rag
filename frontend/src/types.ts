export const SearchStrategy = {
  AGENTIC: 'agentic',
  KEYWORD: 'keyword',
  SEMANTIC: 'semantic',
  HYBRID: 'hybrid',
} as const;

export type SearchStrategy =
  (typeof SearchStrategy)[keyof typeof SearchStrategy];

export type Thread = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type RunStatus = 'running' | 'completed' | 'failed';

export type RunInput = {
  query: string;
  strategy: SearchStrategy;
  model: string;
  reasoning: boolean;
};

export type RunEvent =
  | {
      event: 'message';
      data: {
        id: string;
        content: string;
        reasoningContent: string;
      };
    }
  | {
      event: 'tool_input';
      data: {
        id: string;
        name: string;
        input: {
          type: 'semantic' | 'keyword' | 'hybrid';
          query: string;
          topK?: number;
        };
      };
    }
  | {
      event: 'tool_output';
      data: {
        id: string;
        output: string;
      };
    };

export type Run = {
  id: string;
  status: RunStatus;
  input: RunInput;
  events: RunEvent[];
  error: string | null;
  created_at: string;
  updated_at: string;
};

export const LLMProvider = {
  OpenRouter: 'openrouter',
  Ollama: 'ollama',
} as const;

export type LLMProvider = (typeof LLMProvider)[keyof typeof LLMProvider];

export type LLM = {
  provider: LLMProvider;
  model: string;
  name: string;
  isDefault?: boolean;
};
