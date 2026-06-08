import { DocumentSearchResult, LLMProvider, SearchStrategy } from '../types.js';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenRouter } from '@langchain/openrouter';
import {
  BaseMessage,
  createAgent,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from 'langchain';
import { search } from './search.js';
import { crossEncoder } from './rerank.js';
import { tools } from './tools.js';
import { config, llms } from '../utils/config.js';

const openRouterAnthropicToolCallFix = {
  name: 'openrouter-anthropic-tool-call-fix',
  wrapModelCall: async (request: any, handler: any) => {
    const result = await handler(request);
    if (result?.tool_calls?.length === 0 && Array.isArray(result?.content)) {
      const toolCalls = (result.content as any[])
        .filter((block) => block.id && block.name && block.args !== undefined)
        .map((block) => ({
          name: block.name,
          args: typeof block.args === 'string' ? JSON.parse(block.args) : block.args,
          id: block.id,
          type: 'tool_call' as const,
        }));
      if (toolCalls.length > 0) {
        return { ...result, tool_calls: toolCalls };
      }
    }
    return result;
  },
};

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
  invoke: async function (
    messages: BaseMessage[],
    query: string,
    strategy: SearchStrategy,
    model: string,
    reasoning: boolean,
    signal: AbortSignal,
  ) {
    let reRankedResults: DocumentSearchResult[] = [];

    if (strategy !== SearchStrategy.AGENTIC) {
      const results = await search[strategy](query, 10);

      reRankedResults = (
        await crossEncoder.instance().reRank(results, query)
      ).splice(0, 10);
    }

    const modelConfig = llms.find((m) => m.model === model)!;
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
            modelKwargs: {
              reasoning: {
                enabled: reasoning,
              }
            }
          });
    const ragAgent = createAgent({
      model: llm,
      tools: strategy === SearchStrategy.AGENTIC ? tools.getAll() : [],
      middleware:
        strategy === SearchStrategy.AGENTIC
          ? modelConfig.provider === LLMProvider.Ollama
            ? [ollamaStringifyMiddleware]
            : [openRouterAnthropicToolCallFix]
          : [],
    });
    const userMessage = new HumanMessage(query);
    const updatedMessages =
      messages.length && strategy === SearchStrategy.AGENTIC
        ? messages.concat(userMessage)
        : [
            new SystemMessage(
              `You are a helpful assistant for answering questions based on the retrieved documents. If the query cannot be answered with the provided documents, say you don't know.${
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
            userMessage,
          ];
    const response = await ragAgent.invoke(
      { messages: updatedMessages },
      { signal },
    );

    return response.messages;
  },
};
