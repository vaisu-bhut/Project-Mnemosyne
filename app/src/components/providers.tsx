"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { ModeProvider } from "@/lib/mode/ModeProvider";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";

/** Client-side app providers: server state, auth session, Guardian mode, toasts. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ModeProvider>{children}</ModeProvider>
      </AuthProvider>
      <Toaster richColors position="top-right" />
      <ServiceWorkerRegistrar />
    </QueryClientProvider>
  );
}
