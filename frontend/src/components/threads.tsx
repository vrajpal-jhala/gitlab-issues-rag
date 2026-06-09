import type { App as ServerApp } from '../../../backend/src';
import type { Thread } from '../types';
import { treaty } from '@elysiajs/eden';
import { use, type MouseEvent } from 'react';
import LoadingBubbles from './loading-bubbles';
import { Context } from '../Context';
import Heading from './heading';

const app = treaty<ServerApp>(location.href);

interface ITheadsProps {
  loadingThreads: boolean;
  threads: Thread[];
  onThreadCreate: () => void;
  onThreadClick: (threadId: string) => void;
  onThreadDelete: (threadId: string) => void;
}

const Threads = (props: ITheadsProps) => {
  const { handleError } = use(Context);
  const {
    loadingThreads,
    threads,
    onThreadCreate,
    onThreadClick,
    onThreadDelete,
  } = props;

  const handleDeleteThread = async (e: MouseEvent<HTMLButtonElement>) => {
    const {
      currentTarget: {
        dataset: { id },
      },
    } = e;

    e.stopPropagation();

    const { error } = await app.api.threads({ id: id! }).delete();

    if (error) {
      handleError(error.value.message || 'Failed to delete thread');
      return;
    }

    onThreadDelete(id!);
  };

  return (
    <div id="threads">
      <Heading>💬 Sessions</Heading>
      <button className="ghost" onClick={onThreadCreate}>
        + &nbsp; New
      </button>
      {loadingThreads ? (
        <LoadingBubbles />
      ) : threads.length ? (
        <div id="thread-list">
          {threads.map((thread) => (
            <div
              key={thread.id}
              id="thread"
              onClick={() => onThreadClick(thread.id)}
            >
              <button id="thread-title" className="ghost">
                {thread.title}
              </button>
              <button
                id="thread-action"
                className="danger"
                data-id={thread.id}
                onClick={handleDeleteThread}
              >
                X
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default Threads;
