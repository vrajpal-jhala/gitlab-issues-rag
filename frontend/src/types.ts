export const SearchStrategy = {
  AGENTIC: 'agentic',
  KEYWORD: 'keyword',
  SEMANTIC: 'semantic',
  HYBRID: 'hybrid',
} as const;

export type SearchStrategy =
  (typeof SearchStrategy)[keyof typeof SearchStrategy];

export const MessageType = {
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export type UserMessage = {
  id: string;
  type: typeof MessageType.USER;
  content: string;
};

export type AssistantMessage = {
  id: string;
  type: typeof MessageType.ASSISTANT;
  content: string;
  reasoningContent: string;
};

export type ToolMessage = {
  id: string;
  type: typeof MessageType.TOOL;
  name: string;
  input: {
    type: 'semantic' | 'keyword';
    query: string;
    topK?: number;
  };
  output?: string;
};

export type Message = UserMessage | AssistantMessage | ToolMessage;

export const LLMProvider = {
  OpenRouter: 'openrouter',
  Ollama: 'ollama',
} as const;

export type LLMProvider =
  (typeof LLMProvider)[keyof typeof LLMProvider];

export type LLM = {
  provider: LLMProvider;
  model: string;
  name: string;
};
