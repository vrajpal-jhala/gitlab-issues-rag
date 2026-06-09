import type { App as ServerApp } from '../../backend/src/index';
import {
  SearchStrategy,
  type Thread,
  type LLM,
  type Run,
  type RunEvent,
  type RunStatus,
} from './types';
import { use, useEffect, useRef, useState, type MouseEvent } from 'react';
import { treaty } from '@elysiajs/eden';
import Threads from './components/threads';
import Chat from './components/chat';
import { Context } from './Context';
import { randomId } from './utils';

const app = treaty<ServerApp>(location.href);

const SELECTED_THREAD_KEY = 'selectedThreadId';

// One ordered stream of frames the server sends: the run's events closed by a
// run_end control frame carrying the terminal status.
type StreamFrame = { event: 'run_end'; data: { status: RunStatus } } | RunEvent;

// Collapse tool calls and assistant reasoning by default.
const collapsibleIds = (runs: Run[]): string[] =>
  runs.flatMap((run) =>
    run.events.flatMap((e) =>
      e.event === 'tool_input' || e.event === 'message' ? [e.data.id] : [],
    ),
  );

function App() {
  const { handleError } = use(Context);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  // Closes the active SSE connection (back / navigate) WITHOUT cancelling the run.
  const abortControllerRef = useRef<AbortController | null>(null);
  // The id of the run currently streaming — used to stop it.
  const currentRunIdRef = useRef<string | null>(null);

  const collapse = (id: string) =>
    setCollapsed((prev) => (prev.includes(id) ? prev : [...prev, id]));

  /**
   * Apply a single ordered event stream into `runs`. The backend already merges
   * buffered + live events into one gap-free stream, so we just fold each frame
   * in by run id — no client-side merging of multiple sources.
   */
  const consumeStream = async (
    stream: AsyncIterable<StreamFrame>,
    runId: string,
    signal: AbortSignal,
  ) => {
    try {
      for await (const frame of stream) {
        // Stop writing the moment this consumer is superseded. Aborting a fetch
        // doesn't synchronously end the iterator, so without this guard a stale
        // loop (e.g. after Back → re-open) keeps folding events into the run
        // alongside the new consumer — duplicating the whole list.
        if (signal.aborted) break;

        if (frame.event === 'run_end') {
          const { status } = frame.data;
          setRuns((prev) =>
            prev.map((r) => (r.id === runId ? { ...r, status } : r)),
          );
          continue;
        }

        if (frame.event === 'tool_input' || frame.event === 'message') {
          collapse(frame.data.id);
        }

        setRuns((prev) =>
          prev.map((run) => {
            if (run.id !== runId) return run;

            const events = [...run.events];

            if (frame.event === 'message') {
              const last = events[events.length - 1];

              if (last?.event === 'message' && last.data.id === frame.data.id) {
                // Accumulate chunks of the same message.
                events[events.length - 1] = {
                  event: 'message',
                  data: {
                    id: last.data.id,
                    content: last.data.content + frame.data.content,
                    reasoningContent:
                      last.data.reasoningContent + frame.data.reasoningContent,
                  },
                };
              } else if (frame.data.content || frame.data.reasoningContent) {
                events.push({ event: 'message', data: { ...frame.data } });
              }
            } else if (frame.event === 'tool_input') {
              events.push({ event: 'tool_input', data: { ...frame.data } });
            } else if (frame.event === 'tool_output') {
              events.push({ event: 'tool_output', data: { ...frame.data } });
            }

            return { ...run, events };
          }),
        );
      }
    } catch (e) {
      // Stream closed (back / navigate / superseded) — the run keeps running on
      // the backend; nothing to do here. Anything else is a real error.
      if ((e as Error)?.name !== 'AbortError') throw e;
    }
  };

  /** Load a thread's history and reattach to any run still in progress. */
  const openThread = async (id: string) => {
    // Supersede any consumer still tailing a previous run — and any older
    // openThread call still awaiting its history fetch — so neither writes
    // stale state over this view (see consumeStream's signal guard). The
    // controller is created up front so every await below is tied to it.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setSelectedThreadId(id);
    localStorage.setItem(SELECTED_THREAD_KEY, id);
    setRuns([]);
    setCollapsed([]);
    setLoadingRuns(false);

    let history;
    try {
      history = await app.api
        .threads({ id })
        .history.get({ fetch: { signal: controller.signal } });
    } catch (e) {
      // Superseded before the response arrived — the newer call owns the view.
      if ((e as Error)?.name === 'AbortError') return;
      throw e;
    }

    if (history.error) {
      handleError(history.error.value.message || 'Fetch to failed thread history');
      return;
    }

    if (controller.signal.aborted) return;

    const data = history.data;
    setRuns(data);
    setCollapsed(collapsibleIds(data));

    // Resume runs that were still going (e.g. started before a refresh).
    const running = data.filter((r) => r.status === 'running');
    if (!running.length) return;

    setLoadingRuns(true);

    for (const run of running) {
      if (controller.signal.aborted) return;

      currentRunIdRef.current = run.id;

      let stream;
      try {
        stream = await app.api
          .threads({ id })
          .runs({ runId: run.id })
          .stream.get({ fetch: { signal: controller.signal } });
      } catch (e) {
        // Left the thread before the stream even opened — nothing to do.
        if ((e as Error)?.name === 'AbortError') return;
        throw e;
      }

      if (stream.error || !stream.data) continue;

      await consumeStream(stream.data, run.id, controller.signal);
    }

    // If we were superseded (navigated to another thread / went back), bail
    // before touching state so we don't clobber the current view.
    if (controller.signal.aborted) return;

    // A resumed stream yields nothing if the run finished and already left
    // server memory — refresh from history so the persisted final state
    // (status, events) is authoritative.
    try {
      const { data: latest } = await app.api
        .threads({ id })
        .history.get({ fetch: { signal: controller.signal } });

      if (latest && !controller.signal.aborted) {
        setRuns(latest);
        setCollapsed(collapsibleIds(latest));
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') throw e;
    }
    setLoadingRuns(false);
  };

  useEffect(() => {
    (async () => {
      setLoadingThreads(true);

      const { data, error } = await app.api.threads.get();

      if (error) {
        handleError(error.value.message || 'Fetch to failed threads');
      }

      if (data) {
        setThreads(data);
      }

      setLoadingThreads(false);

      // Restore the last open thread and resume any in-progress run.
      const savedId = localStorage.getItem(SELECTED_THREAD_KEY);
      if (savedId) openThread(savedId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleError]);

  const handleCreateThread = () => {
    setSelectedThreadId(randomId());
  }

  const handleSelectThread = (id: string) => openThread(id);

  const handleDeleteThread = (threadId: string) => {
    setThreads((prev) => prev.filter(({ id }) => id !== threadId));
  };

  const handleBack = () => {
    // Close the SSE connection only — the run continues on the backend.
    abortControllerRef.current?.abort();
    setSelectedThreadId(null);
    localStorage.removeItem(SELECTED_THREAD_KEY);
    setRuns([]);
    setCollapsed([]);
    setLoadingRuns(false);
  };

  const handleCollapse = (e: MouseEvent<HTMLElement>) => {
    const {
      currentTarget: {
        dataset: { id: messageId },
      },
    } = e;

    setCollapsed((prev) =>
      prev.includes(messageId!)
        ? prev.filter((id) => id !== messageId)
        : [...prev, messageId!],
    );
  };

  // Explicitly cancel the running run. This is the ONLY thing that stops it —
  // refreshing or navigating away just closes the stream.
  const handleStop = async () => {
    const runId = currentRunIdRef.current;
    if (!runId || !selectedThreadId) return;

    setLoadingRuns(false);
    await app.api.threads({ id: selectedThreadId }).runs({ runId }).stop.post();
    // The stream will emit run_end (status 'failed') and close on its own.
  };

  const handleSearch = async (
    query: string,
    strategy: SearchStrategy,
    model: LLM['model'],
    reasoning: boolean,
  ) => {
    // Supersede any consumer still tailing a previous run before we replace the
    // controller, so its loop stops writing (see consumeStream's signal guard).
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoadingRuns(true);

    // Reuse the current thread or start a fresh one.
    let threadId = selectedThreadId;

    if (!threadId) {
      const title = query.length > 60 ? query.slice(0, 60) + '…' : query;

      threadId = randomId();
      setSelectedThreadId(threadId);
      localStorage.setItem(SELECTED_THREAD_KEY, threadId);
      setThreads((prev) => [
        {
          id: threadId!,
          title,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }

    const runId = randomId();
    currentRunIdRef.current = runId;

    // Append the in-flight run immediately so the user query renders at once.
    setRuns((prev) => [
      ...prev,
      {
        id: runId,
        status: 'running',
        input: { query, strategy, model, reasoning },
        events: [],
        error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const { data, error } = await app.api
      .threads({ id: threadId })
      .runs({ runId })
      .stream.post(
        { query, strategy, reasoning, model },
        { fetch: { signal: controller.signal } },
      );

    if (error || !data) {
      handleError(error?.value.message || 'Failed to fetch response');
      setRuns((prev) =>
        prev.map((r) =>
          r.id === runId
            ? { ...r, status: 'failed', error: error?.value.message ?? null }
            : r,
        ),
      );
      setLoadingRuns(false);
      return;
    }

    await consumeStream(data, runId, controller.signal);

    // Superseded by a newer stream — let that one own the UI state.
    if (controller.signal.aborted) return;

    setLoadingRuns(false);
  };

  const shouldShowThreads =
    (!!threads.length && !selectedThreadId) || loadingThreads;

  return shouldShowThreads ? (
    <Threads
      loadingThreads={loadingThreads}
      threads={threads}
      onThreadCreate={handleCreateThread}
      onThreadClick={handleSelectThread}
      onThreadDelete={handleDeleteThread}
    />
  ) : (
    <Chat
      threads={threads}
      loadingRuns={loadingRuns}
      runs={runs}
      collapsed={collapsed}
      onCollapse={handleCollapse}
      onSearch={handleSearch}
      onStop={handleStop}
      onBack={handleBack}
    />
  );
}

export default App;
