import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { NotFound } from "../components/not-found";
import { AppFrame } from "../components/shell";
import { ToastProvider } from "../components/ui";
import { qc } from "../lib/query";
import { ThemeProvider } from "../lib/session";

export const Route = createRootRoute({
  component: () => (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <ToastProvider>
          <AppFrame>
            <Outlet />
          </AppFrame>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  ),
  notFoundComponent: NotFound,
});
