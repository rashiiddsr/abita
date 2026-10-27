/**
 * Navigasi di atas TanStack Router dengan href biasa ("/staff/12", "/attendance?chip=telat").
 * Semua path relatif terhadap basepath /admin.
 */
import { Link as RouterLink, useNavigate, useParams as useRouteParams, useRouter as useTanstackRouter, useRouterState } from "@tanstack/react-router";
import { useMemo, type AnchorHTMLAttributes } from "react";

type Search = Record<string, string>;

export const parseSearch = (s: string): Search => Object.fromEntries(new URLSearchParams(s));
export const stringifySearch = (o: Record<string, unknown>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

/** "/attendance?chip=telat" -> { to: "/attendance", search: { chip: "telat" } } */
function split(href: string): { to: string; search: Search } {
  const i = href.indexOf("?");
  return i < 0 ? { to: href, search: {} } : { to: href.slice(0, i), search: parseSearch(href.slice(i + 1)) };
}

export function useRouter() {
  const navigate = useNavigate();
  const router = useTanstackRouter();
  return useMemo(
    () => ({
      push: (href: string) => navigate({ ...(split(href) as { to: never; search: never }) }),
      replace: (href: string) => navigate({ ...(split(href) as { to: never; search: never }), replace: true }),
      back: () => router.history.back(),
      /** muat ulang data rute (pengganti router.refresh() Next.js) */
      refresh: () => router.invalidate(),
    }),
    [navigate, router],
  );
}

/** Path saat ini tanpa basepath (mis. "/staff/12"). */
export const usePathname = () => useRouterState({ select: (s) => s.location.pathname });

export function useSearchParams(): URLSearchParams {
  const str = useRouterState({ select: (s) => s.location.searchStr });
  return useMemo(() => new URLSearchParams(str), [str]);
}

export function useParams<T extends Record<string, string>>(): T {
  const params: Record<string, string> = useRouteParams({ strict: false });
  return params as T;
}

export function Link({ href, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string }) {
  const { to, search } = split(href);
  return <RouterLink to={to as never} search={search as never} {...props} />;
}
