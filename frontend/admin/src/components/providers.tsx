import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";

const ToastCtx = createContext<(msg: string) => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
          },
        },
      }),
  );
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((msg: string) => {
    clearTimeout(timer.current);
    setToast(msg);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  return (
    <QueryClientProvider client={client}>
      <ToastCtx.Provider value={show}>
        {children}
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-5 z-[60] flex max-w-[calc(100%-32px)] items-center gap-2 rounded-full bg-strong px-[18px] py-[11px] text-[13px] font-medium text-on-strong shadow-card ring-1 ring-line transition-all duration-300"
          style={{ transform: `translate(-50%, ${toast ? "0" : "-16px"})`, opacity: toast ? 1 : 0 }}
        >
          <Check size={15} strokeWidth={2.6} className="flex-none text-[#7FD9A6]" />
          <span className="truncate">{toast}</span>
        </div>
      </ToastCtx.Provider>
    </QueryClientProvider>
  );
}
