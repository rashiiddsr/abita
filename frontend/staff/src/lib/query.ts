import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: true },
  },
});
