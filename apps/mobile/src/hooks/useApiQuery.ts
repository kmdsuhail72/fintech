import { useQuery } from '@tanstack/react-query';
import { api } from '../services/runtime';
import { useSession } from '../hooks/useSession';
export function useApiQuery<T>(
  key: string,
  path: string,
  options: { public?: boolean; interval?: number; enabled?: boolean } = {},
) {
  const { status, user } = useSession();
  return useQuery({
    queryKey: [key, user?.id ?? 'guest', path],
    queryFn: ({ signal }) => api.request<T>(path, { signal, public: options.public ?? false }),
    enabled: (options.enabled ?? true) && (options.public || status === 'ready'),
    refetchInterval: options.interval ?? false,
  });
}
