import type { App as ServerApp } from '../../backend/src/index';
import {
  SearchStrategy,
  type Thread,
  type LLM,
  type Run,
  type RunEvent,
} from './types';
import { use, useEffect, useRef, useState, type MouseEvent } from 'react';
import { treaty } from '@elysiajs/eden';
import Threads from './components/threads';
import Chat from './components/chat';
import { Context } from './Context';
import { randomId } from './utils';

const app = treaty<ServerApp>(location.href);

function App() {
  const { handleError } = use(Context);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);

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
    })();
  }, [handleError]);

  const handleSelectThread = async (id: string) => {
    abortControllerRef.current?.abort();
    setSelectedThreadId(id);
    setRuns([]);
    setCollapsed([]);

    const { data, error } = await app.api.threads({ id }).history.get();

    if (error) {
      handleError(error.value.message || 'Fetch to failed thread history');
      return;
    }

    setRuns(data);
    // Collapse all tool calls and assistant messages with reasoning by default
    setCollapsed(
      data.flatMap((run) =>
        run.events.flatMap((e) => {
          if (e.event === 'tool_input') return [e.data.id];
          if (e.event === 'message') return [e.data.id];
          return [];
        }),
      ),
    );

    const activeRun = data.find((run) => run.status === 'running');

    if (activeRun) await reconnect(id, activeRun);
  };

  const handleDeleteThread = (threadId: string) => {
    setThreads((prev) => prev.filter(({ id }) => id !== threadId));
  };

  const handleBack = () => {
    abortControllerRef.current?.abort();
    setSelectedThreadId(null);
    setRuns([]);
    setCollapsed([]);
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

  const handleStop = async () => {
    abortControllerRef.current?.abort();
    setLoadingRuns(false);

    const runId = currentRunIdRef.current;

    if (selectedThreadId && runId) {
      await app.api
        .threads({ id: selectedThreadId })
        .runs({ runId })
        .abort.post();
      setRuns((prev) =>
        prev.map((r) => (r.id === runId ? { ...r, status: 'completed' } : r)),
      );
    }
  };

  const consumeStream = async (
    stream: AsyncIterable<RunEvent> | null,
    runId: string,
    signal: AbortSignal,
  ) => {
    if (!stream) return;

    let messageId: string | null = null;

    try {
      for await (const { event, data: chunk } of stream) {
        // Stop writing the moment this consumer is superseded. Aborting a fetch
        // doesn't synchronously end the iterator, so without this guard a stale
        // loop (e.g. after Back → re-open) keeps folding events into the run
        // alongside the new consumer — duplicating the whole list.
        if (signal.aborted) break;

        // Collapsed state is updated outside the runs updater to avoid calling setState inside another setState callback.
        if (event === 'tool_input') {
          setCollapsed((prev) => [...prev, chunk.id]);
        }

        if (event === 'message') {
          if (!messageId) {
            messageId = chunk.id;
            setCollapsed((prev) => [...prev, messageId!]);
          }
        } else {
          messageId = null;
        }

        setRuns((prev) =>
          prev.map((run) => {
            if (run.id !== runId) return run;

            const events = [...run.events];

            if (event === 'message') {
              const last = events[events.length - 1];

              if (last?.event === 'message') {
                // Accumulate subsequent chunks into the existing message event.
                events[events.length - 1] = {
                  event: 'message',
                  data: {
                    id: last.data.id,
                    content: last.data.content + chunk.content,
                    reasoningContent:
                      last.data.reasoningContent + chunk.reasoningContent,
                  },
                };
              } else if (chunk.content || chunk.reasoningContent) {
                events.push({
                  event: 'message',
                  data: {
                    id: chunk.id,
                    content: chunk.content,
                    reasoningContent: chunk.reasoningContent,
                  },
                });
              }
            } else if (event === 'tool_input') {
              events.push({
                event: 'tool_input',
                data: { id: chunk.id, name: chunk.name, input: chunk.input },
              });
            } else if (event === 'tool_output') {
              events.push({
                event: 'tool_output',
                data: { id: chunk.id, output: chunk.output },
              });
            }

            return { ...run, events };
          }),
        );
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') throw e;
    }
  };

  // Re-attach to a run already executing on the server and tail it to the end,
  // then refresh from history so the persisted final state (status, events) is
  // authoritative — covers the race where the run finishes between the history
  // fetch and this re-attach.
  const reconnect = async (threadId: string, run: Run) => {
    const runId = run.id;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    currentRunIdRef.current = runId;
    setLoadingRuns(true);

    // Same create-or-attach endpoint as a fresh search — the server sees the run
    // already exists and just re-attaches us to its live stream instead of
    // re-running it. We resend the original input to satisfy the route's schema.
    let data;
    let error;
    try {
      ({ data, error } = await app.api
        .threads({ id: threadId })
        .runs({ runId })
        .stream.post(run.input, { fetch: { signal: controller.signal } }));
    } catch (e) {
      // Left/stopped before the stream even opened — nothing to do.
      if ((e as Error)?.name === 'AbortError') return;
      throw e;
    }

    if (error) {
      handleError(error.value.message || 'Failed to resume run');
      setLoadingRuns(false);
      return;
    }

    await consumeStream(data, runId, controller.signal);

    // If we were superseded (navigated to another thread / went back), bail
    // before touching state so we don't clobber the current view.
    if (controller.signal.aborted) return;

    const { data: history } = await app.api
      .threads({ id: threadId })
      .history.get();
    if (history && !controller.signal.aborted) setRuns(history);
    setLoadingRuns(false);
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

    if (error) {
      handleError(error.value.message || 'Failed to fetch response');
      setRuns((prev) =>
        prev.map((r) =>
          r.id === runId
            ? { ...r, status: 'failed', error: error.value.message ?? null }
            : r,
        ),
      );
      setLoadingRuns(false);

      return;
    }

    await consumeStream(data, runId, controller.signal);

    // Superseded by a newer stream — let that one own the UI state.
    if (controller.signal.aborted) return;

    setRuns((prev) =>
      prev.map((r) =>
        r.id === runId && r.status === 'running'
          ? { ...r, status: 'completed' }
          : r,
      ),
    );
    setLoadingRuns(false);
  };

  const shouldShowThreads =
    (!!threads.length && !selectedThreadId) || loadingThreads;

  return shouldShowThreads ? (
    <Threads
      loadingThreads={loadingThreads}
      threads={threads}
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
