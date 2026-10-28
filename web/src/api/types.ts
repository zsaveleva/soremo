import type { FeatureCollection, Point, Polygon } from 'geojson';

export type BuildingFunction =
  | 'industrial'
  | 'warehouse'
  | 'culture'
  | 'administrative'
  | 'research'
  | 'retail'
  | 'sport'
  | 'other';

export type BuildingFeatureProps = {
  address: string;
  year_built: number;
  original_function: BuildingFunction;
  area_total_m2: number;
  source: 'base' | 'user';
  is_demo: boolean;
};

export type ClusterProps = { cluster: true; count: number };

export type BuildingsResponse = FeatureCollection<Polygon | Point, BuildingFeatureProps | ClusterProps>;

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export type AccuracyLevel = 'low' | 'mid' | 'high';

export type BuildingContext = {
  metro_name: string;
  metro_dist_m: number;
  transit_index: number;
  social_500m: number;
  commercial_density: number;
  business_activity: number;
};

export type BuildingCard = {
  id: number;
  address: string;
  name: string | null;
  year_built: number;
  original_function: BuildingFunction;
  floors: number;
  area_total_m2: number;
  area_site_m2: number;
  area_footprint_m2: number;
  vri: string;
  pzz_zone: string;
  is_okn: boolean;
  legal_status: string;
  source: 'base' | 'user';
  is_demo: boolean;
  geometry: Polygon;
  center: [number, number];
  context: BuildingContext;
  accuracy: { level: AccuracyLevel; docs_pending: number; docs_accepted: number };
  my_report_id: string | null;
};

export type SearchHit = {
  id: number;
  address: string;
  name: string | null;
  year_built: number;
  original_function: BuildingFunction;
  is_demo: boolean;
  source: 'base' | 'user';
  center: [number, number];
};

export type NumRange = { min: number; max: number };

export type TEPValues = { area_total_m2: number; area_rentable_m2: number; floors: number; parking: number };

export type Scenario = {
  title: string;
  function_code: string;
  scale: 'local' | 'city';
  description: string;
  tep: { before: TEPValues; after: TEPValues };
  zoning: { function: string; share: number }[];
  economics: { capex_rub: NumRange; term_months: NumRange; revenue_year_rub: NumRange; payback_years: NumRange };
  risks: string[];
  assumptions?: { capex_per_m2_rub: number; rent_rub_m2_month: number; occupancy: number; noi_share: number };
};

export type EngineOutput = {
  summary: string;
  scenarios: Scenario[];
  methodology: string;
  accuracy_level: AccuracyLevel;
  warnings: string[];
};

export type ReportStatus = 'queued' | 'running' | 'ready' | 'failed';

export type Report = {
  id: string;
  kind: 'demo' | 'user';
  status: ReportStatus;
  accuracy_level: AccuracyLevel;
  engine_version: string;
  created_at: string;
  finished_at: string | null;
  refined: boolean;
  building: BuildingCard;
  result: EngineOutput | null;
};

export type DemoBuilding = { id: number; address: string; name: string | null; center: [number, number] };

export type MyReport = {
  id: string;
  building_id: number;
  address: string;
  name: string | null;
  original_function: BuildingFunction;
  year_built: number;
  status: ReportStatus;
  accuracy_level: AccuracyLevel;
  created_at: string;
  finished_at: string | null;
  versions: number;
};

export type DocKind = 'survey' | 'expertise' | 'other';
export type ReviewStatus = 'pending' | 'accepted' | 'rejected';

export type Doc = {
  id: string;
  building_id: number;
  address: string;
  kind: DocKind;
  issued_on: string;
  file_name: string;
  mime: string;
  size: number;
  status: ReviewStatus;
  review_comment: string | null;
  created_at: string;
};

export type ObjectRequest = {
  id: string;
  building_id: number;
  address: string;
  status: ReviewStatus;
  comment: string | null;
  review_comment: string | null;
  created_at: string;
};
