import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { type PropsWithChildren, useState } from "react";

const queryConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
};

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient(queryConfig));

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
