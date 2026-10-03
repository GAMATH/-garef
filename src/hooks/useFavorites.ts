import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/app/AppContext';
import { useToast } from '@/components/ui/Toast';

export function useFavorites() {
  const { api, profile } = useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['me', 'favoriteIds', profile?.id], queryFn: () => api.listFavoriteIds(profile!.id), enabled: !!profile });
  const m = useMutation({
    mutationFn: (businessId: string) => api.toggleFavorite(profile!.id, businessId),
    onMutate: async (businessId) => {
      const key = ['me', 'favoriteIds', profile?.id];
      const prev = qc.getQueryData<string[]>(key) ?? [];
      qc.setQueryData(key, prev.includes(businessId) ? prev.filter((x) => x !== businessId) : [...prev, businessId]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(['me', 'favoriteIds', profile?.id], ctx?.prev);
      toast(t('errors.generic'), 'error');
    },
    onSuccess: (added) => toast(added ? t('favorites.added') : t('favorites.removed')),
    onSettled: () => qc.invalidateQueries({ queryKey: ['me', 'favorites'] }),
  });
  return {
    isFavorite: (id: string) => !!q.data?.includes(id),
    toggle: (id: string) => {
      if (!profile) {
        toast(t('favorites.loginFirst'), 'info');
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      m.mutate(id);
    },
  };
}
