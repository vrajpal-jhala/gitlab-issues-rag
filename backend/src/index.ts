import { DocumentSearchResult, SearchStrategy } from './types.js';
import { Elysia, sse } from 'elysia';
import { node } from '@elysiajs/node';
import { cors } from '@elysiajs/cors';
import { z } from 'zod';
import { search } from './components/search.js';
import { crossEncoder } from './components/rerank.js';
import { services } from './utils/services.js';
import { llms } from './utils/config.js';
import { agent } from './components/agent.js';

const PORT = 3000;

// Initialize services (e.g., build indexes)
await services.init();

export const app = new Elysia({ adapter: node() })
  .group('/api', (app) =>
    app
      .use(cors())
      .post(
        '/ask',
        async function* ({ body, request }) {
          const { strategy, query, reasoning, model } = body;
          let reRankedResults: DocumentSearchResult[] = [];

          if (strategy !== SearchStrategy.AGENTIC) {
            const results = await search[strategy](query, 10);

            reRankedResults = (
              await crossEncoder.instance().reRank(results, query)
            ).splice(0, 10);
          }

          const modelConfig = llms.find((m) => m.model === model)!;

          try {
            for await (const [mode, chunk] of await agent.stream(
              query,
              strategy,
              reasoning,
              modelConfig,
              reRankedResults,
              request.signal
            )) {
              if (mode === 'messages') {
                if (chunk[0].type === 'tool') continue;

                yield sse({
                  event: 'message',
                  data: {
                    content: chunk[0].content,
                    reasoningContent:
                      chunk[0].additional_kwargs.reasoning_content || '',
                  },
                });
              }

              if (mode === 'tools') {
                if (chunk.event === 'on_tool_start') {
                  yield sse({
                    event: 'tool_input',
                    data: {
                      id: chunk.toolCallId!,
                      name: chunk.name,
                      input: JSON.parse(chunk.input as string) as {
                        type: 'semantic' | 'keyword';
                        query: string;
                        topK?: number;
                      },
                    },
                  });
                }

                if (chunk.event === 'on_tool_end') {
                  yield sse({
                    event: 'tool_output',
                    data: {
                      id: chunk.toolCallId!,
                      name: chunk.name,
                      output: (chunk.output as { content: string }).content,
                    },
                  });
                }
              }
            }
          } catch (e: any) {
            if (e?.name !== 'AbortError') throw e;
          }
        },
        {
          body: z.object({
            query: z.string().min(1, { message: 'Query is required' }),
            strategy: z.enum(SearchStrategy, 'Invalid search strategy'),
            reasoning: z.boolean().optional().default(false),
            model: z.enum(llms.map((m) => m.model)),
          }),
        },
      )
      .get('/models', () => {
        return llms;
      }),
  )
  .listen(PORT);

console.log(`🦊 Elysia is running at http://localhost:${PORT}`);

export type App = typeof app;
