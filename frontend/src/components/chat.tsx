import type { MouseEventHandler } from 'react';
import type { LLM, Run, SearchStrategy, Thread } from '../types';
import Messages from './messages';
import Searchbar from './searchbar';
import Heading from './heading';

interface IChatProps {
  threads: Thread[],
  runs: Run[];
  collapsed: string[];
  onCollapse: MouseEventHandler<HTMLElement>;
  loadingRuns: boolean;
  onSearch: (
    query: string,
    strategy: SearchStrategy,
    model: LLM['model'],
    reasoning: boolean,
  ) => void;
  onStop: () => void;
  onBack: () => void;
}

const Chat = (props: IChatProps) => {
  const {
    threads,
    runs,
    collapsed,
    onCollapse,
    loadingRuns,
    onSearch,
    onStop,
    onBack,
  } = props;

  return (
    <div id="chat" className={!runs.length ? 'empty' : undefined}>
      {!!threads.length && <button id="back-button" className="ghost" onClick={onBack}>
        &lt; &nbsp; Back to sessions
      </button>}
      {runs.length ? (
        <Messages
          runs={runs}
          collapsed={collapsed}
          onCollapse={onCollapse}
          loading={loadingRuns}
        />
      ) : (
        <Heading>👋 Hi there!</Heading>
      )}
      <Searchbar
        loading={loadingRuns}
        runs={runs}
        onSearch={onSearch}
        onStop={onStop}
      />
    </div>
  );
};

export default Chat;
