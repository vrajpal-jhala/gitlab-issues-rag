import {
  RunEvent,
  Run,
  SearchStrategy,
  Thread,
  MessageEvent,
  RunInput,
} from './types.js';
import { Elysia, sse } from 'elysia';
import { node } from '@elysiajs/node';
import { cors } from '@elysiajs/cors';
import { z } from 'zod';
import { workflow } from './components/workflow.js';
import { services } from './utils/services.js';
import { llms } from './utils/config.js';
import { getDb } from './utils/db.js';

const PORT = 3000;

// Initialize services (e.g., build indexes)
await services.init();

export const app = new Elysia({ adapter: node() })
  .group('/api', (app) =>
    app
      .use(cors())
      .post(
        '/threads/:id/runs/stream',
        async function* ({ body, params, request }) {
          const { strategy, query, reasoning, model } = body;
          const { id: threadId } = params;
          const title = query.length > 60 ? query.slice(0, 60) + '…' : query;

          getDb()
            .prepare(
              `INSERT INTO threads (id, title) VALUES (?, ?)
               ON CONFLICT (id) DO UPDATE SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
            )
            .run(threadId, title);

          const runId = crypto.randomUUID();
          const startCheckpointId = await workflow.getCheckpointId(threadId);

          getDb()
            .prepare(
              `INSERT INTO runs (id, thread_id, start_checkpoint_id, status, input)
               VALUES (?, ?, ?, 'running', ?)`,
            )
            .run(
              runId,
              threadId,
              startCheckpointId,
              JSON.stringify({ query, strategy, model, reasoning }),
            );

          const stream = workflow.stream(
            query,
            strategy,
            model,
            reasoning,
            threadId,
            request.signal,
          );

          const events: RunEvent[] = [];
          let currentMessage: MessageEvent['data'] | null = null;

          const flushMessage = () => {
            if (currentMessage) {
              events.push({ event: 'message', data: currentMessage });
              currentMessage = null;
            }
          };

          try {
            for await (const event of stream) {
              if (event.event === 'message') {
                if (!currentMessage) {
                  currentMessage = { id: event.data.id, content: '', reasoningContent: '' };
                }
                currentMessage.content += event.data.content;
                currentMessage.reasoningContent += event.data.reasoningContent;
              } else {
                flushMessage();
                events.push(event);
              }
              yield sse(event);
            }

            flushMessage();

            const endCheckpointId = await workflow.getCheckpointId(threadId);

            getDb()
              .prepare(
                `UPDATE runs SET status='completed', end_checkpoint_id=?, events=?,
                 updated_at=datetime('now') WHERE id=?`,
              )
              .run(endCheckpointId, JSON.stringify(events), runId);
          } catch (e: any) {
            if (e?.name === 'AbortError') return;

            getDb()
              .prepare(
                `UPDATE runs SET status='failed', error=?, updated_at=datetime('now') WHERE id=?`,
              )
              .run(e.message ?? 'Unknown error', runId);

            throw e;
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
      .get('/threads', () => {
        return getDb()
          .prepare<
            unknown[],
            Thread
          >('SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC')
          .all();
      })
      .delete('/threads/:id', ({ params: { id }, set }) => {
        const result = getDb()
          .prepare<string, Thread>('DELETE from threads WHERE id = ?')
          .run(id);

        if (!result.changes) {
          set.status = 404;

          return { error: 'Thread not found' };
        }

        return '';
      })
      .get('/threads/:id/history', ({ params: { id } }) => {
        return getDb()
          .prepare<string, Run>(
            `SELECT id, thread_id, start_checkpoint_id, end_checkpoint_id,
                    status, input, events, error, created_at
             FROM runs WHERE thread_id = ? ORDER BY created_at ASC`,
          )
          .all(id)
          .map((run) => ({
            ...run,
            input: JSON.parse(run.input as unknown as string) as RunInput,
            events: JSON.parse(run.events as unknown as string) as RunEvent[],
          }));
      })
      .get('/models', () => {
        return llms;
      }),
  )
  .listen(PORT);

console.log(`🦊 Elysia is running at http://localhost:${PORT}`);

export type App = typeof app;
