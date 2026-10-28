import type { AccuracyLevel, BuildingFunction, DocKind, ReviewStatus } from '../api/types';
import type { BadgeTone } from '../design/components';

export const FUNCTION_LABEL: Record<BuildingFunction, string> = {
  industrial: 'Производственное',
  warehouse: 'Складское',
  culture: 'Культурно-досуговое',
  administrative: 'Административное',
  research: 'Научное',
  retail: 'Торговое',
  sport: 'Спортивное',
  other: 'Иное',
};

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  survey: 'Техническое обследование',
  expertise: 'Экспертиза',
  other: 'Иной документ',
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: 'На проверке',
  accepted: 'Принят',
  rejected: 'Отклонён',
};

export const REVIEW_TONE: Record<ReviewStatus, BadgeTone> = {
  pending: 'pending',
  accepted: 'accepted',
  rejected: 'rejected',
};

export const ACCURACY_LABEL: Record<AccuracyLevel, string> = {
  low: 'низкая, ≈30%',
  mid: 'средняя, ≈60%',
  high: 'высокая, ≈85%',
};
