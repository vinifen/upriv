import { useCallback, useState } from "react";

export function useRefreshState(durationMs = 800) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    window.setTimeout(() => setIsRefreshing(false), durationMs);
  }, [durationMs]);

  return { isRefreshing, refresh };
}
