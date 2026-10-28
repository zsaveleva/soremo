import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { BuildingCard, DemoBuilding, Report, SearchHit } from './types';

export function useBuilding(id: number | null) {
  return useQuery({
    queryKey: ['building', id],
    enabled: id !== null,
    queryFn: ({ signal }) => api<BuildingCard>(`/buildings/${id}`, { signal }),
  });
}

export function useSearch(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ['search', trimmed],
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => api<SearchHit[]>(`/buildings/search?q=${encodeURIComponent(trimmed)}`, { signal }),
  });
}

export function useDemoBuildings() {
  return useQuery({
    queryKey: ['demo-buildings'],
    staleTime: Infinity,
    queryFn: ({ signal }) => api<DemoBuilding[]>('/demo/buildings', { signal }),
  });
}

export function useDemoReport(buildingId: number) {
  return useQuery({
    queryKey: ['demo-report', buildingId],
    queryFn: ({ signal }) => api<Report>(`/demo/reports/${buildingId}`, { signal }),
  });
}

export function useMyReports(enabled = true) {
  return useQuery({ queryKey: ['my-reports'], enabled, queryFn: () => api<import('./types').MyReport[]>('/me/reports') });
}

export function useMyDocuments(enabled = true) {
  return useQuery({ queryKey: ['my-documents'], enabled, queryFn: () => api<import('./types').Doc[]>('/me/documents') });
}

export function useMyObjectRequests(enabled = true) {
  return useQuery({
    queryKey: ['my-object-requests'],
    enabled,
    queryFn: () => api<import('./types').ObjectRequest[]>('/me/object-requests'),
  });
}
