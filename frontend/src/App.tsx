import type { App as ServerApp } from '../../backend/src/index';
import { MessageType, SearchStrategy, type LLM, type Message } from './types';
import { use, useRef, useState } from 'react';
import { treaty } from '@elysiajs/eden';
import Searchbar from './components/searchbar';
import Welcome from './components/welcome';
import Messages from './components/messages';
import { Context } from './Context';

const app = treaty<ServerApp>(location.href);

function App() {
  const { handleError } = use(Context);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [collapsed, setCollapsed] = useState<Message['id'][]>([]);

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  };

  const handleSearch = async (
    query: string,
    strategy: SearchStrategy,
    model: LLM['model'],
    reasoning: boolean,
  ) => {
    abortControllerRef.current = new AbortController();
    setIsLoading(true);
    setMessages((prev) =>
      prev.concat([
        {
          id: Math.random().toString(36).substring(2, 15),
          type: MessageType.USER,
          content: query,
        },
      ]),
    );
    const { data, error } = await app.api.ask.post(
      { query, strategy, reasoning, model },
      { fetch: { signal: abortControllerRef.current!.signal } },
    );

    if (error) {
      handleError(error.value.message || 'Failed to fetch response');
      setIsLoading(false);

      return;
    }

    for await (const { event, data: chunk } of data) {
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        const newId = Math.random().toString(36).substring(2, 15);

        if (event === 'message') {
          setCollapsed((prev) => [...prev, newId]);

          if (lastMessage && lastMessage.type === MessageType.ASSISTANT) {
            return [
              ...prev.slice(0, -1),
              {
                ...lastMessage,
                ...(chunk.content
                  ? { content: lastMessage.content + chunk.content }
                  : {
                      reasoningContent:
                        lastMessage.reasoningContent + chunk.reasoningContent,
                    }),
              },
            ];
          }

          if (chunk.content || chunk.reasoningContent) {
            return prev.concat([
              {
                id: newId,
                type: MessageType.ASSISTANT,
                content: chunk.content as string,
                reasoningContent: chunk.reasoningContent as string,
              },
            ]);
          }
        }

        if (event === 'tool_input') {
          setCollapsed((prev) => [...prev, chunk.id]);

          return prev.concat([
            {
              id: chunk.id,
              type: MessageType.TOOL,
              name: chunk.name,
              input: chunk.input,
              output: '{}',
            },
          ]);
        }

        if (event === 'tool_output') {
          return prev.map((message) => {
            if (message.type === MessageType.TOOL && message.id === chunk.id) {
              return {
                ...message,
                output: chunk.output,
              };
            }
            return message;
          });
        }

        return prev;
      });
    }

    setIsLoading(false);
  };

  return (
    <>
      <div id="chat" className={!messages.length ? 'empty' : undefined}>
        {messages.length ? (
          <Messages
            messages={messages}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            isLoading={isLoading}
          />
        ) : (
          <Welcome />
        )}
        <Searchbar
          loading={isLoading}
          messages={messages}
          onSearch={handleSearch}
          onStop={handleStop}
        />
      </div>
    </>
  );
}

export default App;
