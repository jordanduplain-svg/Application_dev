import { QueryClient } from '@tanstack/react-query';

// MOD-01 : singleton QueryClient avec staleTime 60s et retry 1.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 minute
      retry: 1,
    },
  },
});
