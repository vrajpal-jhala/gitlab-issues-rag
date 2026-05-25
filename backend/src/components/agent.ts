import { DocumentSearchResult, LLM, LLMProvider, SearchStrategy } from '../types.js';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenRouter } from '@langchain/openrouter';
import {
  BaseMessage,
  createAgent,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from 'langchain';
import { tools } from './tools.js';
import { config } from '../utils/config.js';

const ollamaStringifyMiddleware = {
  name: 'ollama-stringify-tool-messages',
  wrapModelCall: async (request: any, handler: any) => {
    const messages = (request.messages as BaseMessage[]).map((msg) => {
      if (msg instanceof ToolMessage && typeof msg.content !== 'string') {
        return new ToolMessage({
          tool_call_id: msg.tool_call_id,
          content: Array.isArray(msg.content)
            ? msg.content
                .map((c: any) =>
                  typeof c === 'string' ? c : (c.text ?? JSON.stringify(c)),
                )
                .join('\n')
            : JSON.stringify(msg.content),
        });
      }
      return msg;
    });
    return handler({ ...request, messages });
  },
};

export const agent = {
  stream: async function (
    query: string,
    strategy: SearchStrategy,
    reasoning: boolean,
    modelConfig: LLM,
    reRankedResults: DocumentSearchResult[],
    signal: AbortSignal,
  ) {
    const llm =
      modelConfig.provider === LLMProvider.Ollama
        ? new ChatOllama({
            model: modelConfig.model,
            temperature: config.generation.temperature,
            baseUrl: config.generation.provider[modelConfig.provider].url,
            think: reasoning,
          })
        : new ChatOpenRouter({
            model: modelConfig.model,
            temperature: config.generation.temperature,
            apiKey: config.generation.provider[modelConfig.provider].apiKey,
          });
    const agent = createAgent({
      model: llm,
      tools: strategy === SearchStrategy.AGENTIC ? tools.getAll() : [],
      middleware:
        modelConfig?.provider === LLMProvider.Ollama &&
        strategy === SearchStrategy.AGENTIC
          ? [ollamaStringifyMiddleware]
          : [],
    });

    return agent.stream(
      {
        messages: [
          new SystemMessage(
            `You are a helpful assistant for answering questions based on the retrieved documents. If the query cannot be answered with the provided documents, say you don't know.\n\n${
              strategy !== SearchStrategy.AGENTIC
                ? `Here are the retrieved documents:\n\n${reRankedResults
                    .map(
                      (r) =>
                        `Document ID: ${r.id}\nContent: ${r.pageContent}\nScore: ${r.score.toFixed(
                          4,
                        )}`,
                    )
                    .join('\n\n')}\n\n`
                : ''
            }`,
          ),
          new HumanMessage(query),
        ],
      },
      {
        streamMode: ['messages', 'tools'],
        signal,
      },
    );
  },
};
