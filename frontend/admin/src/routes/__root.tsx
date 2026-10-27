import { createRootRoute, Outlet } from "@tanstack/react-router";
import { NotFound } from "@/components/not-found";
import { Providers } from "@/components/providers";

export const Route = createRootRoute({
  component: () => (
    <Providers>
      <Outlet />
    </Providers>
  ),
  notFoundComponent: NotFound,
});
