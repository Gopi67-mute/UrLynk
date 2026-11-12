import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useAccountId } from "@/hooks/use-account-id";
import { createQueryClient } from "./query-client";

/**
 * Server-state cache for the signed-in account.
 *
 * Created once per app launch, and emptied whenever the signed-in account changes —
 * including on sign-out. Query keys are already scoped by account ID, so this is the
 * second of two guards: nothing another leader fetched can stay in memory, and the
 * next account starts from a cold cache instead of someone else's numbers.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const accountId = useAccountId();

  useEffect(() => {
    queryClient.clear();
  }, [accountId, queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
