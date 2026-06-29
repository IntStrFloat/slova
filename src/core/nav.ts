import { useRouter } from 'expo-router';
import { useCallback } from 'react';

/**
 * Безопасный возврат назад. Если стек навигации пуст (web/диплинк/после
 * перезагрузки страницы), `router.back()` кидает «GO_BACK was not handled by
 * any navigator». В этом случае уходим на карту (`/`).
 */
export function useGoBack(): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
}
