import type { App as ServerApp } from '../../backend/src/index';
import { SearchStrategy, type Thread, type LLM, type Run } from './types';
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
  };

  const handleDeleteThread = (threadId: string) => {
    setThreads((prev) => prev.filter(({ id }) => id !== threadId));
  };

  const handleBack = () => {
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

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setLoadingRuns(false);
  };

  const handleSearch = async (
    query: string,
    strategy: SearchStrategy,
    model: LLM['model'],
    reasoning: boolean,
  ) => {
    abortControllerRef.current = new AbortController();
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

    // Append the in-flight run immediately so the user query renders at once.
    const runId = randomId();
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
      .runs.stream.post(
        { query, strategy, reasoning, model },
        { fetch: { signal: abortControllerRef.current!.signal } },
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

    let messageId: string | null = null;

    for await (const { event, data: chunk } of data) {
      // Collapsed state is updated outside the runs updater to avoid calling
      // setState inside another setState callback.
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

      setRuns((prev) => {
        const all = [...prev];
        const current = { ...all[all.length - 1] };
        const events = [...current.events];

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
            data: {
              id: chunk.id,
              name: chunk.name,
              input: chunk.input,
            },
          });
        } else if (event === 'tool_output') {
          events.push({
            event: 'tool_output',
            data: { id: chunk.id, output: chunk.output },
          });
        }

        current.events = events;
        all[all.length - 1] = current;

        return all;
      });
    }

    setRuns((prev) =>
      prev.map((r) => (r.id === runId ? { ...r, status: 'completed' } : r)),
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
