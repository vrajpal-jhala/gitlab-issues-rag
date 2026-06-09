import { MessageEvent, RunEvent, RunStatus, SearchStrategy } from '../types.js';
import { workflow } from './workflow.js';
import { getDb } from '../utils/db.js';

type RunParams = {
  threadId: string;
  query: string;
  strategy: SearchStrategy;
  model: string;
  reasoning: boolean;
};

// null is the end-of-stream sentinel pushed once the run finishes.
type Subscriber = (event: RunEvent | null) => void;

type ActiveRun = {
  events: RunEvent[]; // raw events buffered for catch-up replay
  subscribers: Set<Subscriber>; // live consumers currently tailing this run
  status: 'running' | 'completed' | 'failed';
  controller: AbortController; // cancels the underlying graph
};

// Process-local registry. Swappable for Redis Streams without touching the HTTP layer.
const activeRuns = new Map<string, ActiveRun>();

// Keep a finished run around briefly so a client connecting just after completion
// still gets the full replay; after this it's gone (history endpoint serves the DB copy).
const CLEANUP_GRACE_MS = 60_000;

export const runManager = {
  /**
   * Fire-and-forget: registers the run and drives the graph detached from any
   * HTTP request. The run survives client disconnects. Idempotent — calling
   * with an id that's already active is a no-op, so a retried request can't
   * spawn a duplicate graph.
   */
  start(runId: string, params: RunParams): void {
    if (activeRuns.has(runId)) return;

    const run: ActiveRun = {
      events: [],
      subscribers: new Set(),
      status: 'running',
      controller: new AbortController(),
    };

    activeRuns.set(runId, run);
    void execute(runId, run, params);
  },

  /**
   * Subscribe to a run: replays everything buffered so far, then tails live
   * events until the run completes. Safe to call any time while the run is
   * active (or within the cleanup grace window after it finishes).
   */
  async *stream(runId: string): AsyncGenerator<RunEvent> {
    const run = activeRuns.get(runId);
    if (!run) return;

    const queue: RunEvent[] = [];
    let ended = false;
    let wake: (() => void) | null = null;

    const onEvent: Subscriber = (event) => {
      if (event === null) ended = true;
      else queue.push(event);
      wake?.();
      wake = null;
    };

    // Snapshot the catch-up buffer and register the subscriber atomically — no
    // await between these two lines, so no event can slip through the gap.
    const replayCount = run.events.length;
    run.subscribers.add(onEvent);
    if (run.status !== 'running') ended = true;

    try {
      // Catch-up: events that existed before we subscribed.
      for (let i = 0; i < replayCount; i++) yield run.events[i];

      // Live tail: everything from subscribe-time onward arrives via the queue.
      while (true) {
        while (queue.length) yield queue.shift()!;
        if (ended) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      run.subscribers.delete(onEvent);
    }
  },

  /**
   * Cancels the underlying graph. The run then fails with an 'Aborted' error,
   * which is persisted and signalled to every live subscriber.
   */
  abort(runId: string): boolean {
    const run = activeRuns.get(runId);
    if (!run || run.status !== 'running') return false;

    run.controller.abort();
    return true;
  },

  /** Current status, or null once the run has been cleaned up. */
  getStatus(runId: string): RunStatus | null {
    return activeRuns.get(runId)?.status ?? null;
  },
};

/**
 * The producer. Drives the graph, fans raw events out to live subscribers,
 * accumulates the persisted shape, and writes the run row to the DB.
 */
async function execute(
  runId: string,
  run: ActiveRun,
  params: RunParams,
): Promise<void> {
  const { threadId, query, strategy, model, reasoning } = params;

  const accumulated: RunEvent[] = [];
  let currentMessage: MessageEvent['data'] | null = null;

  const flushMessage = () => {
    if (currentMessage) {
      accumulated.push({ event: 'message', data: currentMessage });
      currentMessage = null;
    }
  };

  const emit = (event: RunEvent) => {
    run.events.push(event);
    for (const sub of run.subscribers) sub(event);
  };

  try {
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
      run.controller.signal,
    );

    for await (const event of stream) {
      emit(event);

      // Accumulate the persisted shape: merge message chunks, keep tool events as-is.
      if (event.event === 'message') {
        if (!currentMessage) {
          currentMessage = { id: event.data.id, content: '', reasoningContent: '' };
        }
        currentMessage.content += event.data.content;
        currentMessage.reasoningContent += event.data.reasoningContent;
      } else {
        flushMessage();
        accumulated.push(event);
      }
    }

    flushMessage();

    const endCheckpointId = await workflow.getCheckpointId(threadId);

    getDb()
      .prepare(
        `UPDATE runs SET status='completed', end_checkpoint_id=?, events=?,
         updated_at=datetime('now') WHERE id=?`,
      )
      .run(endCheckpointId, JSON.stringify(accumulated), runId);

    run.status = 'completed';
  } catch (e: any) {
    flushMessage();
    run.status = 'failed';

    const error = e?.name === 'AbortError' ? 'Aborted' : e?.message ?? 'Unknown error';

    // Persist whatever streamed before the failure (no-op if the INSERT never ran).
    getDb()
      .prepare(
        `UPDATE runs SET status='failed', error=?, events=?,
         updated_at=datetime('now') WHERE id=?`,
      )
      .run(error, JSON.stringify(accumulated), runId);
  } finally {
    // Signal end-of-stream to every live subscriber, then schedule cleanup.
    for (const sub of run.subscribers) sub(null);
    setTimeout(() => activeRuns.delete(runId), CLEANUP_GRACE_MS);
  }
}
