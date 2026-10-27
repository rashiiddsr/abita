import "@fontsource-variable/inter";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotFound } from "@/components/not-found";
import { parseSearch, stringifySearch } from "@/lib/nav";
import { routeTree } from "./routeTree.gen";
import { installEnterNext } from "@/lib/enter-next";
import "./styles.css";

const router = createRouter({
  routeTree,
  basepath: "/admin",
  defaultNotFoundComponent: NotFound,
  defaultPreload: "intent",
  scrollRestoration: true,
  // query string biasa (?chip=telat&detail=12), bukan format JSON bawaan TanStack
  parseSearch,
  stringifySearch,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

installEnterNext(); // Enter = kolom berikutnya, kolom terakhir = kirim
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
