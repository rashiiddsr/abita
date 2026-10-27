import { createFileRoute, redirect } from "@tanstack/react-router";

// /staff -> /staff/dashboard (belum masuk: layout _auth mengarahkan ke /staff/login)
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});
