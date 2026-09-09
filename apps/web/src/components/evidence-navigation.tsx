"use client";

import {
  createContext,
  useContext,
  useMemo,
  useOptimistic,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

type Scope = { area: string; view: string; trial: number; status: string };
const Context = createContext<{
  scope: Scope;
  pending: boolean;
  href: (patch: Partial<Scope>) => string;
  navigate: (patch: Partial<Scope>, reset?: boolean) => void;
} | null>(null);

// Chart and outcome controls must share optimistic navigation. Otherwise a
// second click can restore query parameters from an unfinished first request.
export function EvidenceNavigation({
  base,
  area = "",
  view,
  trial,
  status = "",
  children,
}: {
  base: string;
  area?: string;
  view: string;
  trial: number;
  status?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const initial = useMemo(
    () => ({ area, view, trial, status }),
    [area, view, trial, status],
  );
  const [scope, setScope] = useOptimistic(initial);
  const [pending, startTransition] = useTransition();
  const href = (patch: Partial<Scope>) => {
    const value = { ...scope, ...patch };
    const [path, search] = base.split("?");
    const params = new URLSearchParams(search);
    if (value.area) params.set("dim", value.area);
    if (value.view !== "skill") params.set("view", value.view);
    if (value.trial) params.set("evidenceTrial", String(value.trial));
    if (value.status) params.set("status", value.status);
    return `${path}?${params}`;
  };
  const navigate = (patch: Partial<Scope>, reset = false) => {
    const next = { ...scope, ...patch, ...(reset ? { status: "" } : {}) };
    startTransition(() => {
      setScope(next);
      router.push(href(next), { scroll: false });
    });
  };
  return (
    <Context.Provider value={{ scope, pending, href, navigate }}>
      {children}
    </Context.Provider>
  );
}
export function useEvidenceNavigation() {
  const context = useContext(Context);
  if (!context) throw new Error("Evidence controls require shared navigation");
  return context;
}
export function EvidenceOutcomeFilters() {
  const { scope, href, navigate } = useEvidenceNavigation();
  return (
    <div className="filters" aria-label="Case outcome filters">
      {["", "FAIL", "PARTIAL", "ERROR", "PASS"].map((status) => (
        <a
          key={status}
          className={`filter ${scope.status === status ? "on" : ""}`}
          aria-current={scope.status === status ? "true" : undefined}
          href={href({ status })}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            navigate({ status });
          }}
        >
          {status ? status[0] + status.slice(1).toLowerCase() : "All"}
        </a>
      ))}
    </div>
  );
}
