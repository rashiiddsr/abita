/**
 * Navigasi di atas TanStack Router dengan path biasa ("/dashboard", "/shift"), relatif terhadap basepath /staff.
 * nav(-1) = kembali di riwayat browser.
 */
import { Link as RouterLink, Navigate as RouterNavigate, useNavigate as useRouterNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, type AnchorHTMLAttributes, type ReactNode } from "react";

export const parseSearch = (s: string): Record<string, string> => Object.fromEntries(new URLSearchParams(s));
export const stringifySearch = (o: Record<string, unknown>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

export function useNavigate() {
  const navigate = useRouterNavigate();
  const router = useRouter();
  return useCallback(
    (to: string | number, opts?: { replace?: boolean }) => {
      if (typeof to === "number") return router.history.go(to);
      // "/documents?tab=mine" -> path + search
      const i = to.indexOf("?");
      void navigate({ to: (i < 0 ? to : to.slice(0, i)) as never, search: (i < 0 ? undefined : parseSearch(to.slice(i + 1))) as never, replace: opts?.replace });
    },
    [navigate, router],
  );
}

/** Lokasi saat ini; pathname tanpa basepath (mis. "/change-password"). */
export const useLocation = () => useRouterState({ select: (s) => s.location });

export const Navigate = ({ to, replace }: { to: string; replace?: boolean }) => <RouterNavigate to={to as never} replace={replace} />;

export const Link = ({ to, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string }) => <RouterLink to={to as never} {...props} />;

/** Tautan bar navigasi: aktif bila path sama (end) atau di bawahnya. */
export function NavLink({
  to,
  end,
  className,
  children,
}: {
  to: string;
  end?: boolean;
  className: (s: { isActive: boolean }) => string;
  children: (s: { isActive: boolean }) => ReactNode;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isActive = end ? path === to : path === to || path.startsWith(to + "/");
  return (
    <RouterLink to={to as never} className={className({ isActive })} aria-current={isActive ? "page" : undefined}>
      {children({ isActive })}
    </RouterLink>
  );
}
