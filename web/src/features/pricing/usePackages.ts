import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export type Package = { id: number; objects_limit: number | null; months: number; price_rub: number };

export function usePackages() {
  return useQuery({ queryKey: ['packages'], staleTime: 10 * 60_000, queryFn: () => api<Package[]>('/packages') });
}

export const OBJECT_STEPS: (number | null)[] = [1, 5, 25, 100, null];
export const MONTH_STEPS = [1, 3, 6, 12];

export function findPackage(ps: Package[] | undefined, objects: number | null, months: number) {
  return ps?.find((p) => p.objects_limit === objects && p.months === months);
}
