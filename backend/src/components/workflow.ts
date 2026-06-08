import { RunEvent, SearchStrategy, SearchType } from '../types.js';
import { z } from 'zod';
import {
  START,
  END,
  StateGraph,
  StateSchema,
  MessagesValue,
} from '@langchain/langgraph';
import { agent } from './agent.js';
import { llms } from '../utils/config.js';
import { getSqliteSaver } from '../utils/db.js';

const state = new StateSchema({
  query: z.string(),
  strategy: z.enum(['agentic', 'keyword', 'semantic', 'hybrid']),
  reasoning: z.boolean().optional().default(false),
  model: z.enum(llms.map((m) => m.model)),
  messages: MessagesValue,
});
type CompiledWorkflow = Awaited<ReturnType<typeof buildWorkflow>>;
async function buildWorkflow() {
  return new StateGraph(state)
    .addNode('agent', async (state, { signal }) => {
      const { query, strategy, reasoning, model, messages } = state;
      const updatedMessages = await agent.invoke(
        messages,
        query,
        strategy,
        model,
        reasoning,
        signal,
      );

      return { messages: updatedMessages };
    })
    .addEdge(START, 'agent')
    .addEdge('agent', END)
    .compile({
      name: 'RAG Agent',
      description:
        'An agent that answers questions based on retrieved documents using different search strategies and LLMs.',
      checkpointer: getSqliteSaver(),
    });
}

let ragWorkflow: CompiledWorkflow | null = null;

export const workflow = {
  init: async () => {
    ragWorkflow = await buildWorkflow();
  },
  getCheckpointId: async (threadId: string): Promise<string | null> => {
    if (!ragWorkflow) throw new Error('Workflow not initialized');

    const state = await ragWorkflow.getState({ configurable: { thread_id: threadId } });

    return state?.config?.configurable?.checkpoint_id ?? null;
  },
  stream: async function* (
    query: string,
    strategy: SearchStrategy,
    model: string,
    reasoning: boolean,
    threadId: string,
    signal: AbortSignal,
  ): AsyncGenerator<RunEvent> {
    if (!ragWorkflow) {
      throw new Error('Workflow not initialized');
    }

    let messageId: string | null = null;

    for await (const [mode, chunk] of await ragWorkflow.stream(
      {
        query,
        strategy,
        reasoning,
        model,
        messages: [],
      },
      {
        configurable: { thread_id: threadId },
        streamMode: ['messages', 'tools'],
        signal,
      },
    )) {
      if (mode === 'messages') {
        if (chunk[0].type === 'tool') continue;

        if (!messageId) messageId = chunk[0].id ?? crypto.randomUUID();

        yield {
          event: 'message',
          data: {
            id: messageId,
            content: chunk[0].content as string,
            reasoningContent:
              (chunk[0].additional_kwargs.reasoning_content as string) || '',
          },
        };
      } else {
        messageId = null;
      }

      if (mode === 'tools') {
        if (chunk.event === 'on_tool_start') {
          yield {
            event: 'tool_input',
            data: {
              id: chunk.toolCallId!,
              name: chunk.name,
              input: JSON.parse(chunk.input as string) as {
                type: SearchType;
                query: string;
                topK?: number;
              },
            },
          };
        }

        if (chunk.event === 'on_tool_end') {
          yield {
            event: 'tool_output',
            data: {
              id: chunk.toolCallId!,
              output: (chunk.output as { content: string }).content,
            },
          };
        }
      }
    }
  },
};
