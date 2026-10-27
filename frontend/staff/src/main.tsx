import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotFound } from "./components/not-found";
import { Spinner } from "./components/ui";
import { parseSearch, stringifySearch } from "./lib/nav";
import { routeTree } from "./routeTree.gen";
import { installEnterNext } from "./lib/enter-next";
import "./styles.css";

const router = createRouter({
  routeTree,
  basepath: "/staff",
  defaultNotFoundComponent: NotFound,
  // halaman kamera memuat MediaPipe (besar, dipisah per rute): tampilkan pemuat bila lama
  defaultPendingComponent: () => (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner />
    </div>
  ),
  defaultPreload: "intent",
  scrollRestoration: true,
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
