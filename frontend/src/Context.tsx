import { createContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const Context = createContext({
  // eslint-disable-next-line
  handleError: (_message: string) => {},
});

const ContextProvider = ({ children }: { children: React.ReactNode }) => {
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleError = (message: string = 'An error occurred') => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    setToast(message);

    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  return (
    <Context value={{ handleError }}>
      {children}
      {toast &&
        createPortal(
          <div id="toast" className="error">
            {toast}
          </div>,
          document.body,
        )}
    </Context>
  );
};

export { Context, ContextProvider };
