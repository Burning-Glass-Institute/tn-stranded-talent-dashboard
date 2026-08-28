/**
 * View-store data layer.
 * ======================
 * The R pipeline (R/reports/build_web_views.R) precomputes exactly the aggregates
 * the dashboard renders and writes them to output/reports/web/*.json. The prebuild
 * step (scripts/sync_web_data.mjs) copies those into public/data/, where they are
 * served as static assets and fetched at runtime. No cell-level microdata is ever
 * bundled into or downloaded by the browser, and output/ is the single source of
 * truth — the app cannot silently diverge from the pipeline.
 *
 * Everything except skills.json is fetched once at startup (initData); skills.json
 * (the largest payload) is fetched lazily on first use (loadSkills), keeping it out
 * of the initial critical path. The generated files are NOT imported, so they never
 * enter the JS bundle — only this module's code does.
 */

// ============================================================================
// TYPES (mirror the shapes emitted by R/reports/build_web_views.R)
// ============================================================================

export type GeoLevel = 'State' | 'MSA' | 'Region';
export type CohortType = 'Low Wage' | 'Underemployed' | 'Stalled' | 'All Stranded';

export interface Meta {
  schema_version: number;
  generated_at: string;
  pub_date: string;
  vintages: {
    pdl_stall: {
      run_date: string | null;
      headline_stall_rate_pct: number | null;
      oews_calibrated_employment: number | null;
      excluded_occupations?: string;
      source: string;
    };
    acs: { source: string; stranded_rate_pct: number | null };
    ai_exposure?: {
      model_version: string; computed: string; adoption_preset: string;
      scenario_id: string; horizon: string; scored: number; note?: string | null;
      // AI headcounts sit on a WIDER universe than every other figure here (stall and
      // ACS both drop managers and classroom teachers), so the base travels with the
      // vintage and the Source Data panel surfaces it rather than leaving it implicit.
      employment_base?: string | null;
      employment_total?: number | null;
      employment_universe?: string | null;
    } | null;
  };
  geographies: { key: string; level: GeoLevel }[];
  sectors: string[];
  cohorts: CohortType[];
  thresholds: { low_wage: number; underemployed_ceiling: number; min_stall_duration_sample: number };
}

export type Pair = [string, number];

export interface Stats {
  total: number | null;
  low_wage: number | null;
  underemployed: number | null;
  stalled: number | null;
  stranded_total: number | null;
  stranded_rate_pct: number | null;
  oews_employment: number | null;
  has_workers: boolean;
  /** False when the ACS has no sample for this cell — distinct from "no workers".
   *  `total`/`low_wage`/`underemployed` are ACS-sourced and read 0 either way, but
   *  `stalled` comes from BGI's Career Histories Dataset / OEWS and can still be a
   *  real, measured count. */
  has_acs: boolean;
}

export interface Demographics { age: Pair[]; education: Pair[] }
export interface CohortSlice { top_occupations: Pair[]; demographics: Demographics }

export interface GeoSectorSlice {
  stats: Stats;
  stalled: {
    durations: Pair[];
    /** Which rung of the shape ladder the histogram rests on (build_web_views.R). */
    duration_basis: 'cell' | 'sector' | 'statewide' | 'none';
    duration_suppressed: boolean;
    /** Completed spells behind the shape actually used (the pooled count when borrowed). */
    duration_n_obs: number | null;
    /** Completed spells in this slice itself, whatever the shape rests on. */
    duration_cell_n_obs: number;
  };
  cohorts: Record<CohortType, CohortSlice>;
}

export interface AIBlock {
  usecase_exposure: number | null;
  auto_exposure: number | null;
  aug_exposure: number | null;
  impact_pct_baseline: number | null;
  headcount_change_baseline: number | null;
  coverage: string | null;
}

export interface Destination {
  name: string;
  soc: string;
  rank: number | null;
  per_1000_switches: number | null;
  skill_similarity_composite: number | null;
  similarity_rating: string | null;
  wage_median_origin: number | null;
  wage_median_destination: number | null;
  wage_gain_median: number | null;
  wage_gain_median_pct: number | null;
  /** Either side's TN median wage came from the OEWS fallback ladder, not a direct
   *  Tennessee observation. See build_acs_wages() in R/shared/00_utils.R. */
  wage_imputed: boolean | null;
  share_stranded_origin: number | null;
  share_stranded_destination: number | null;
  diff_strandedness: number | null;
  prep_label: string | null;
  qualifies_because: string | null;
  low_prep_addon: number | string | boolean | null;
  blend_source: string | null;
  demand_category: string | null;
  demand_growth_category: string | null;
  share_part_time: number | null;
  internal_promotion_rate_5: number | null;
  external_promotion_rate_5: number | null;
  ai: AIBlock;
}

export interface OriginPathways {
  soc: string;
  transitions: Destination[];
  similarity: Destination[];
  transitions_fallback: boolean;
}

export interface OccRef {
  soc: string;
  share_stranded: number | null;
  median_wage: number | null;
  share_low_wage: number | null;
  share_underemployed: number | null;
  share_part_time: number | null;
  internal_promotion_rate_5: number | null;
  external_promotion_rate_5: number | null;
  demand_category: string | null;
  demand_growth_category: string | null;
  n_postings_tn: number | null;
  tn_share: number | null;
  lq: number | null;
  implied_annual_growth_pct: number | null;
  ai: AIBlock;
}

export interface SectorDemand { n_postings_tn: number | null; demand_category: string | null }

export interface SkillGap {
  skill: string;
  skill_gap: number | null;
  rate_origin: number | null;
  rate_destination: number | null;
  destination_importance: number | null;
}
export interface CrossPathwaySkill {
  skill: string;
  n_destination_occs: number;
  total_destination_occs: number;
  avg_skill_gap: number | null;
}
export interface SkillsData {
  by_pair: Record<string, { gaps: SkillGap[] }>;
  cross_pathway: Record<string, CrossPathwaySkill[]>;
}

// ============================================================================
// CURATED REFERENCE (small, versioned in-repo, safe to bundle)
// ============================================================================

import tnLicensesRaw from './reference/tn_licenses.json';
import commonCredsRaw from './reference/common_credentials.json';

export interface LicenseEntry { profession: string; regulation: string; degree: string }
export interface CredentialEntry { credential: string; type: string; description: string }

export const tnLicenses = tnLicensesRaw as Record<string, LicenseEntry[]>;
export const commonCredentials = commonCredsRaw as Record<string, CredentialEntry[]>;

// ============================================================================
// FETCHED VIEW STORE (static assets under /data/, never bundled)
// ============================================================================

const BASE: string = (import.meta as any).env?.BASE_URL || '/';
const url = (file: string) => `${BASE}data/${file}`;

let _meta: Meta;
let _geoSector: Record<string, GeoSectorSlice>;
let _pathways: Record<string, OriginPathways>;
let _reference: {
  occupations: Record<string, OccRef>;
  occupation_sector_demand: Record<string, SectorDemand>;
};
let _counties: any;             // TN county GeoJSON (map geometry, curated)
let _skills: SkillsData | null = null;
let _ready = false;

// The JS bundle is content-hashed but these JSON assets are not, so without a
// cache key a returning visitor can pair a fresh bundle with a browser- or
// CDN-cached view store from a previous vintage — which renders as fields quietly
// missing rather than as an error. meta.json is small and always fetched fresh;
// its generated_at stamp then keys every other file. Keying off the data (not the
// build) also covers a data-only sync, where the bundle hash never changes.
let _dataVersion = '';

async function getJson(file: string, fresh = false): Promise<any> {
  const href = fresh ? url(file) : `${url(file)}?v=${encodeURIComponent(_dataVersion)}`;
  const res = await fetch(href, fresh ? { cache: 'no-store' } : undefined);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Fetch the startup payload once. Skills and (implicitly) nothing else follow lazily. */
export async function initData(): Promise<void> {
  if (_ready) return;
  const meta = await getJson('meta.json', true);
  _dataVersion = String(meta.generated_at ?? meta.pub_date ?? '');
  const [geo, paths, ref, counties] = await Promise.all([
    getJson('geo_sector.json'),
    getJson('pathways.json'),
    getJson('reference.json'),
    getJson('tn-counties.json'),
  ]);
  if (meta.schema_version !== 1) {
    throw new Error(`Unexpected view-store schema_version ${meta.schema_version} (expected 1). Re-run sync.`);
  }
  _meta = meta;
  _geoSector = geo;
  _pathways = paths.by_origin;
  _reference = ref;
  _counties = counties;
  _ready = true;
}

export const isReady = () => _ready;
export const getMeta = (): Meta => _meta;
export const getCountyBoundaries = (): any => _counties;

export const getSlice = (geo: string, sector: string): GeoSectorSlice | undefined =>
  _geoSector[`${geo}|${sector}`];

/** Statewide all-stranded rate (the 3-term low-wage U underemployed + net-new-stalled
 *  union that per-occupation `share_stranded` also measures), pooled over every sector
 *  at geography "All". The view store emits no statewide row -- "All" exists only per
 *  sector -- so it is aggregated once here and memoized. Summing the "All" rows is the
 *  sanctioned aggregation: they are MSA-scope and partition the state by sector, unlike
 *  the Region rows, which independently re-cover it (see build_web_views.R). */
let _statewideStrandedRate: number | null | undefined;
export const getStatewideStrandedRate = (): number | null => {
  if (_statewideStrandedRate !== undefined) return _statewideStrandedRate;
  let workers = 0;
  let stranded = 0;
  for (const [key, slice] of Object.entries(_geoSector)) {
    if (!key.startsWith('All|') || !slice.stats.has_acs) continue;
    workers += slice.stats.total ?? 0;
    stranded += slice.stats.stranded_total ?? 0;
  }
  _statewideStrandedRate = workers > 0 ? stranded / workers : null;
  return _statewideStrandedRate;
};

export const getPathways = (occ: string): OriginPathways | undefined => _pathways[occ];

export const getOccRef = (name: string): OccRef | undefined => _reference.occupations[name];

export const getOccSectorDemand = (occ: string, sector: string): SectorDemand | undefined =>
  _reference.occupation_sector_demand[`${occ}|||${sector}`];

/** Lazily fetch the skill-gap / cross-pathway payload (largest file) on first use. */
export async function loadSkills(): Promise<SkillsData> {
  if (!_skills) _skills = await getJson('skills.json');
  return _skills!;
}
