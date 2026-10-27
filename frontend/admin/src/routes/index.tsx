import { createFileRoute, redirect } from "@tanstack/react-router";

// /admin -> /admin/dashboard (belum masuk: layout _app mengarahkan ke /admin/login)
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});
