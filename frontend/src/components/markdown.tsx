import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface IMarkdownProps {
  content: string;
}

export const Markdown = ({ content }: IMarkdownProps) => {
  return (
    <ReactMarkdown components={{}} remarkPlugins={[remarkGfm]}>
      {content}
    </ReactMarkdown>
  );
};
