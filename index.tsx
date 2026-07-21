/**
 * Tennessee Stranded Talent Interactive Explorer
 * ================================================
 * A policy dashboard for analyzing workforce stratification in Tennessee.
 * Identifies "stranded workers" (low-wage, underemployed, career-stalled)
 * and provides career pathway analysis with skill gap and credential data.
 *
 * Data: the R pipeline (R/reports/build_web_views.R) precomputes exactly the
 * aggregates rendered here into output/reports/web/*.json; the prebuild step syncs
 * them to public/data/, and this app FETCHES them at runtime (see ./src/data). No
 * cell-level microdata is bundled or downloaded — the browser only ever sees the
 * view aggregates it renders, and output/ is the single source of truth.
 *
 * Architecture:
 *   index.tsx (this file) — App loader + Dashboard component, state, rendering
 *   src/data/index.ts — typed accessors over the fetched view store
 *   src/components/TennesseeMap.tsx — interactive D3 map of TN MSA regions
 */

import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MapPin, Briefcase, Target, Download, Users, GraduationCap,
  ArrowRight, ChevronDown, LayoutDashboard, BarChart3, Layers,
  FileText, TrendingUp, Flame, Activity
} from 'lucide-react';
import TennesseeMap from './src/components/TennesseeMap';
import {
  initData, isReady, getMeta, getCountyBoundaries,
  getSlice, getPathways, getOccRef, getOccSectorDemand, loadSkills,
  tnLicenses, commonCredentials,
  type CohortType, type Destination, type SkillsData,
} from './src/data';

// ============================================================================
// TYPES
// ============================================================================

type MSACategory = 'Nashville' | 'Memphis' | 'Knoxville' | 'Chattanooga' | 'Other MSA' | 'East' | 'Middle' | 'West' | 'All';

/** Grand Division (Region) geographies are a different raking scope than the MSAs
 *  and must never be summed with them; "All" is an MSA-only rollup, enforced in R. */
const REGION_GEOS = new Set(['East', 'Middle', 'West']);

/** Display label for the combined non-major-metro bucket. The data key stays 'Other MSA'
 *  (matches the pipeline + view store); only the on-screen label changes. Rural counties are
 *  folded into this bucket to match the PDL stall geography, which has no rural component, so
 *  an "MSA" label would misleadingly imply rural is excluded. */
const OTHER_MSA_LABEL = 'Other & Rural TN';
const geoDisplay = (g: string) => (g === 'Other MSA' ? OTHER_MSA_LABEL : g);

// ============================================================================
// CONSTANTS
// ============================================================================

/** Regex patterns for matching credential-like skills from job postings.
 *  NOTE: credential mining stays client-side, run over the already-fetched skill
 *  gaps — it ships no extra bytes and needs no R port. */
const CREDENTIAL_PATTERNS = [
  /\bcertif/i, /\blicens/i, /\bdegree\b/i, /\baccredit/i,
  /\bCDL\b/, /\bOSHA\b/, /\bCPA\b/, /\bCNA\b/, /\bRN\b/, /\bLPN\b/, /\bLVN\b/,
  /\bAPRN\b/, /\bPA-C\b/, /\bLCSW\b/, /\bLMFT\b/, /\bLMHC\b/, /\bLPC\b/,
  /\bCRNA\b/, /\bCRT\b/, /\bCST\b/, /\bCPC\b/, /\bCCS\b/, /\bCMA\b/,
  /\bBCBA\b/, /\bNBCOT\b/, /\bNCCER\b/, /\bASE\b/, /\bGIAC\b/, /\bLEED\b/,
  /\bServSafe\b/, /\bJourneyman\b/, /\bPeace Officer\b/, /\bTeaching Certificate\b/,
  /\bBoard Certified\b/i, /\bBoard Eligible\b/i,
  /\bDriver's License\b/i, /\bA&P\b.*Certificate/i,
  /\bPMP\b/, /\bSix Sigma\b/i, /\bCompTIA\b/i, /\bCISSP\b/, /\bAWS\b/,
  /\bPhlebotomy\b/i, /\bBLS\b/, /\bCPR\b/, /\bACLS\b/,
  /\bSeries [0-9]/i, /\bEPA\b.*608/i, /\bHAZMAT\b/i,
];

/**
 * Domain-based relevance filter for credential→occupation matching.
 * Maps credential keywords to occupation domains they are relevant to,
 * so that (e.g.) "Adobe Certified Professional" never shows for Sheet Metal Workers.
 */
type CredDomain = 'healthcare' | 'behavioral' | 'trades' | 'tech' | 'finance' | 'food' | 'law_enforcement' | 'education' | 'fitness' | 'aviation' | 'safety' | 'general';

const CRED_TO_DOMAIN: [RegExp, CredDomain][] = [
  // Healthcare / clinical
  [/\bRN\b|Registered Nurse|Nurs(?:e|ing)|LPN\b|LVN\b|APRN\b|PA-C\b|Physician|CNA\b|Certified Nursing/i, 'healthcare'],
  [/\bBLS\b|Basic Life Support|ACLS\b|Advanced Cardiovascular|CPR\b|Cardiopulmonary|AED\b|Heartsaver|NRP\b|Neonatal Resuscitation/i, 'healthcare'],
  [/Phlebotomy|ASCP\b|AMT\b|Radiolog|ARRT\b|Sonograph|Sterile Processing|Hemodialysis|EKG|ECG/i, 'healthcare'],
  [/\bCST\b|Surgical|Medical (?:Assist|Billing|Coding|Licens)|Pharmacy|CCC-SLP|Speech.Language/i, 'healthcare'],
  [/Board Certified|Board Eligible|NBCOT\b|Occupational Therapy|Physical Therap|Respiratory|CRNA\b|CRT\b/i, 'healthcare'],
  [/Dietar|Nutrition|Diabetes Educator|Prosthetist|Orthotist|Massage.*Bodywork|Music Therapist|Therapeu?tic Recreation/i, 'healthcare'],
  [/Immunization|Vaccination|Drug Enforcement|DEA\b|Patient Care|NHA Certified|First Responder|CFR\b/i, 'healthcare'],
  [/Nurse (?:Midwife|Practitioner|Anesthetist)|CNM\b|Certified (?:Nurse|Clinical)|Long Term Monitor/i, 'healthcare'],
  [/Veterinar/i, 'healthcare'],
  // Behavioral health / social work / counseling
  [/LCSW\b|LMFT\b|LMHC\b|LPC\b|BCBA\b|BCaBA\b|Social Work|Counselor|CADC\b|Chemical Dependency/i, 'behavioral'],
  [/Behavior Analyst|Psychiatric|Psychology License|MOAB\b|Aggressive Behavior|Crisis Prevention|CPI\b/i, 'behavioral'],
  [/Case Manager|CCM\b|Community Health Worker|Employment Support|School Social Work/i, 'behavioral'],
  // Construction / trades / transportation
  [/\bCDL\b|Commercial Driver|Chauffeur|Air Brake|Tanker|Doubles.*Triples|TWIC\b|DOT Medical/i, 'trades'],
  [/\bOSHA\b|NCCER\b|Journeyman|Forklift|Crane Operator|Concrete.*ACI|Rigging|Scaffold/i, 'trades'],
  [/\bASE\b|Automotive Service|I-CAR\b|EPA.*608|Refrigerant|HVAC\b|NATE\b|R-410A/i, 'trades'],
  [/Electrician|Plumber|Pipefitter|Lineman|Powerline|NFPA\b|Arc Flash/i, 'trades'],
  [/Lead.Safe|Hazardous Material|HAZMAT\b|HAZWOPER\b|Pesticide|Welding|AWS Certified Weld/i, 'trades'],
  [/Valid Driver's License/i, 'general'],
  // IT / Tech
  [/CompTIA\b|CISSP\b|GIAC\b|Cisco|Microsoft Certified|Oracle.*Cloud|Linux Certified/i, 'tech'],
  [/Information Systems Security|Cyber|Network\+|Security\+|Salesforce|Google Cloud|Red Hat/i, 'tech'],
  // Finance
  [/\bCPA\b|Certified Public Account|CFA\b|Series [0-9]|FINRA\b|Financial Planner/i, 'finance'],
  [/Actuar|Insurance License|Adjuster License|Real Estate.*License|Property Specialist/i, 'finance'],
  [/Benefits Professional|Payroll|Bookkeep/i, 'finance'],
  // Food service
  [/ServSafe\b|Food (?:Safety|Handler)|TIPS\b.*Certification|Alcohol Certification/i, 'food'],
  // Law enforcement
  [/Peace Officer|POST\b.*Certificate|Corrections Officer|Wicklander/i, 'law_enforcement'],
  // Education
  [/Teaching Certificate|Catechist|Career Development Facilitator/i, 'education'],
  // Fitness / recreation
  [/AFAA\b|Personal Trainer|Group Fitness|PSIA.*AASI|Clinical Exercise Specialist/i, 'fitness'],
  // Aviation
  [/Airframe.*Powerplant|A&P\b.*Certificate/i, 'trades'],
  // Safety (cross-domain)
  [/Certified Safety Professional|Loss (?:Prevention|Control)/i, 'safety'],
  // Project management (broadly applicable)
  [/\bPMP\b|Project Management Professional|Six Sigma|Lean Six/i, 'general'],
  [/LEED\b/i, 'trades'],
  // Catch-all for generic cert/license matches
  [/\baccredit/i, 'general'],
  [/\bdegree\b/i, 'general'],
  [/Birth Certificate/i, 'general'],
  [/COVID.*Vaccin/i, 'general'],
  [/First Aid|Red Cross/i, 'general'],
  [/\bCPC\b|Certified Professional Coder|Medical Coding/i, 'healthcare'],
  [/\bCCS\b|Certified Coding Specialist/i, 'healthcare'],
  [/\bCMA\b/i, 'healthcare'],
  [/Alliance.*Information.*Referral/i, 'behavioral'],
  [/Activity Assistant/i, 'healthcare'],
  [/Architecture License/i, 'trades'],
  [/Professional Engineer|PE License/i, 'trades'],
];

const OCC_DOMAINS: [RegExp, CredDomain[]][] = [
  // Healthcare occupations (broad match for medical/clinical roles)
  [/Nurs|Physician|Surgeon|Dental|Pharm|Radiolog|Medical|Health(?!.*Safety)|Clinical|Respiratory|Diagnost|Sonograph|Patholog|Dietitian|Nutritionist|Optom|Chiropract|Veterinar|Podiatr|Speech.Language|Audiolog|Occupational Therap|Physical Therap|Massage|Ambulance|EMT\b|Paramedic|Psychiatric Aide|Orderly|Home Health|Phlebotom|Surgical Tech|Anesthetist|Midwi|Laboratory Tech|Other Therapist/i, ['healthcare', 'general']],
  // Behavioral health
  [/Social Work|Counselor|Psycholog|Mental Health|Substance Abuse|Behavioral|Community Health|Rehabilitation/i, ['behavioral', 'healthcare', 'general']],
  // Trades / construction / transportation
  [/Construct|Carpenter|Electrician|Plumber|Mason\b|Roofer|Welder|Weld|HVAC|Heating.*Air|Mechanic|Driver|Truck|Bus Driver|Heavy.*Equipment|Crane|Excavat|Pipeline|Insulation|Sheet Metal|Ironwork|Drywall|Painter.*Paper|Tile|Cement|Paving|Highway Maint|Hazardous Material|Installation.*Maint|Extraction|Automotive|Diesel|Aircraft Mechanic|Power.Line|Maintenance.*Repair|Machin|CNC|Tool.*Die|Assembler|Fabricat|Water.*Wastewater/i, ['trades', 'safety', 'general']],
  // Aviation (must come before generic patterns that might match "Aircraft")
  [/Pilot|Aircraft|Aviation|Aerospace|Flight Engineer|Air Traffic/i, ['aviation', 'trades', 'general']],
  // IT / Tech
  [/Software|Computer|Web Develop|Network.*Architect|Network.*Admin|Database|Information Security|IT |Systems Admin|Programmer|Data Scien|Cyber/i, ['tech', 'general']],
  // Finance
  [/Account|Auditor|Financial|Actuar|Tax|Budget|Credit|Loan|Securities|Broker|Insurance(?!.*Sales)|Claims|Bookkeep|Payroll/i, ['finance', 'general']],
  // Food service
  [/Cook|Chef|Food Prep|Baker|Bartender|Waiter|Waitress|Restaurant|Food Service|Dining|Cafeteria|Food Processing|Supervisors of Food/i, ['food', 'general']],
  // Law enforcement (includes healthcare for CPR/first aid relevance)
  [/Police|Sheriff|Detective|Correction|Probation|Patrol|Criminal|Telecommunicator|Security Guard/i, ['law_enforcement', 'healthcare', 'general']],
  // Fitness / athletics (MUST come before education to avoid "Instructor" false match)
  [/Fitness|Athletic|Exercise|Recreation|Personal Train|\bSport\b|Coach/i, ['fitness', 'healthcare', 'education', 'general']],
  // Education
  [/Teacher|Professor|Instructor|Tutor|Education|School|Librar|Postsecondary|Teaching Assistant|Religious.*Education|Childcare|Preschool|Kindergarten/i, ['education', 'healthcare', 'general']],
  // Project management / business
  [/Project Management|Management Analyst|Business Operation|Logistician|Compliance|Human Resource|Training.*Development|Compensation.*Benefit|Cost Estimat/i, ['general', 'finance']],
  // Engineers (PE license, trades-adjacent)
  [/Engineer/i, ['trades', 'general']],
  // Safety
  [/Safety Specialist|Safety Technician|Occupational Health/i, ['safety', 'trades', 'general']],
  // Insurance sales
  [/Insurance Sales|Real Estate/i, ['finance', 'general']],
  // Landscaping
  [/Landscap|Groundskeep|Lawn Service|Pest Control/i, ['trades', 'general']],
  // Production / manufacturing supervisors
  [/Supervisors of Production|Industrial Truck|Freight.*Stock|Material Mov|Supervisors of Transportation/i, ['trades', 'safety', 'general']],
  // Inspectors
  [/Inspector|Tester|Sorter|Sampler|Weigher|Building Inspector/i, ['trades', 'general']],
  // Firefighters (need trades for hazmat, healthcare for medical response)
  [/Firefighter/i, ['law_enforcement', 'healthcare', 'trades', 'safety', 'general']],
  // Misc
  [/Graphic Design|Producer|Director/i, ['tech', 'general']],
  [/Paralegal|Legal Assist/i, ['finance', 'general']],
  [/Dispatch/i, ['trades', 'general']],
  [/Postal Service/i, ['general']],
  [/Parts Sales/i, ['trades', 'general']],
  [/Painting Worker/i, ['trades', 'general']],
  [/Precision Instrument/i, ['trades', 'healthcare', 'general']],
  [/Architect/i, ['trades', 'general']],
  [/Other life scientist/i, ['healthcare', 'general']],
  [/Other Healthcare/i, ['healthcare', 'general']],
  [/Miscellaneous Health/i, ['healthcare', 'general']],
];

/** Check if a credential skill name is relevant to a destination occupation */
function isCredentialRelevantToOccupation(skillName: string, destOccupation: string): boolean {
  let credDomain: CredDomain = 'general';
  for (const [pat, domain] of CRED_TO_DOMAIN) {
    if (pat.test(skillName)) { credDomain = domain; break; }
  }
  if (credDomain === 'general') return true;
  let occDomains: CredDomain[] = ['general'];
  for (const [pat, domains] of OCC_DOMAINS) {
    if (pat.test(destOccupation)) { occDomains = domains; break; }
  }
  return occDomains.includes(credDomain);
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

const pluralize = (name: string): string =>
  name.endsWith('s') ? name : name + 's';

/** Text clamped to the container's fixed height at whole-word boundaries. */
const WordClampedText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.textContent = text;
      if (el.scrollHeight <= el.clientHeight + 1) return;
      const words = text.split(/\s+/);
      for (let n = words.length - 1; n >= 1; n--) {
        el.textContent = words.slice(0, n).join(' ').replace(/[\W_]+$/, '') + '...';
        if (el.scrollHeight <= el.clientHeight + 1) return;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return <p ref={ref} className={className} />;
};

/** Horizontal progress bar for demographic/occupational breakdowns */
const ProgressBar: React.FC<{ label: string; value: number; max: number; colorClass: string }> = ({ label, value, max, colorClass }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-[10px] font-bold uppercase tracking-tight text-slate-500">
      <span className="truncate pr-2">{label}</span>
      <span className="tabular-nums">{value.toLocaleString()}</span>
    </div>
    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full transition-all duration-1000 ${colorClass}`}
        style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
    </div>
  </div>
);

/** Demand badge component for pathway cards (reads the fetched reference store). */
const DemandBadge: React.FC<{ occupation?: string | null; sector?: string; compact?: boolean; isSelected?: boolean }> = ({ occupation, sector, compact, isSelected }) => {
  if (!occupation) return null;
  const ref = getOccRef(occupation);
  const sectorDemand = sector ? getOccSectorDemand(occupation, sector) : undefined;
  const category = sectorDemand?.demand_category || ref?.demand_category || 'N/A';
  const trend = ref?.demand_growth_category || null;

  const colorMap: Record<string, string> = {
    'High Demand': isSelected ? 'bg-emerald-400/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700',
    'Medium Demand': isSelected ? 'bg-amber-400/20 text-amber-300' : 'bg-amber-100 text-amber-700',
    'Low Demand': isSelected ? 'bg-red-400/20 text-red-300' : 'bg-red-100 text-red-700',
    'Not Enough Data': isSelected ? 'bg-white/10 text-blue-300' : 'bg-slate-100 text-slate-400',
  };
  const colors = colorMap[category] || (isSelected ? 'bg-white/10 text-blue-300' : 'bg-slate-100 text-slate-500');

  const trendArrow = trend?.includes('Growing') ? ' ↑' : trend?.includes('Declining') ? ' ↓' : trend?.includes('Stable') ? ' →' : '';
  const shortLabel = category.replace(' Demand', '') + trendArrow;

  if (compact) {
    return <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${colors}`}>{shortLabel}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${colors}`}>{shortLabel}</span>
    </div>
  );
};

/** AI displacement-risk model. Bands on impact_pct_baseline (BGI's demand-adjusted
 *  5-year projected change in employer demand). See R/next_steps/tn_ai_exposure.R. */
type AIBand = 'high' | 'med' | 'low' | 'none';
interface AIScore {
  auto: number | null;
  aug: number | null;
  impactPct: number | null;
  band: AIBand;
  bandLabel: string;
  bgSolid: string;
  bgPill: string;
  bgPillDark: string;
}
const scoreAI = (auto?: number | null, aug?: number | null, impactPct?: number | null): AIScore => {
  const a = (auto === undefined || auto === null || isNaN(auto) || auto <= 0.001) ? null : auto;
  const g = (aug === undefined || aug === null || isNaN(aug)) ? null : aug;
  const i = (impactPct === undefined || impactPct === null || isNaN(impactPct)) ? null : impactPct;
  const palette = {
    high: { label: 'High Displacement Risk', bgSolid: 'bg-red-600 text-white border-red-700', bgPill: 'bg-red-600 text-white', bgPillDark: 'bg-red-500 text-white' },
    med: { label: 'Moderate Decline', bgSolid: 'bg-amber-500 text-white border-amber-600', bgPill: 'bg-amber-500 text-white', bgPillDark: 'bg-amber-500 text-white' },
    low: { label: 'Stable / Growing', bgSolid: 'bg-emerald-600 text-white border-emerald-700', bgPill: 'bg-emerald-600 text-white', bgPillDark: 'bg-emerald-500 text-white' },
    none: { label: 'No data', bgSolid: 'bg-slate-200 text-slate-500', bgPill: 'bg-slate-100 text-slate-400', bgPillDark: 'bg-white/10 text-blue-300' },
  };
  if (i === null) {
    return { auto: a, aug: g, impactPct: null, band: 'none', bandLabel: palette.none.label,
      bgSolid: palette.none.bgSolid, bgPill: palette.none.bgPill, bgPillDark: palette.none.bgPillDark };
  }
  // Band on projected 5-year demand change; ±2% is treated as normal churn (Stable).
  // High = ≤ −5% loss, Soft Decline = −5% to −2%, Stable/Growing = > −2%. Thresholds
  // retained for abbe-v2.0 (employment-weighted High share ≈ 17.6%, matches the report).
  let band: AIBand;
  if (i <= -5) band = 'high';
  else if (i <= -2) band = 'med';
  else band = 'low';
  const p = palette[band];
  return { auto: a, aug: g, impactPct: i, band, bandLabel: p.label, bgSolid: p.bgSolid, bgPill: p.bgPill, bgPillDark: p.bgPillDark };
};

/** Single AI displacement-risk pill for destination/pathway cards. */
const AIBadge: React.FC<{ auto?: number | null; aug?: number | null; impactPct?: number | null; isSelected?: boolean }> = ({ auto, aug, impactPct, isSelected }) => {
  const s = scoreAI(auto, aug, impactPct);
  if (s.band === 'none') {
    return <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${isSelected ? s.bgPillDark : s.bgPill}`}>No data</span>;
  }
  const ip = s.impactPct as number;
  const ipRounded = Math.round(ip);
  const shortLabel = s.band === 'high' ? 'Decline' : s.band === 'med' ? 'Soft' : (ipRounded >= 1 ? 'Growth' : 'Stable');
  const ipStr = `${ipRounded >= 0 ? '+' : ''}${ipRounded}%`;
  return (
    <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full ${isSelected ? s.bgPillDark : s.bgPill}`}>
      {shortLabel} · {ipStr}
    </span>
  );
};

// ============================================================================
// REPORT CONTEXT — excerpts from "Mobilizing Stranded Talent" (May 2026)
// woven into the Executive Brief based on the user's geography × sector slice.
// ============================================================================

const REPORT_GEO_CONTEXT: Record<string, string> = {
  'Nashville': 'Nashville consistently posts the lowest strandedness rates in the state — 16.5% low-wage versus 5–8pp higher elsewhere — driven by a deeper professional-tier employer base. The local lesson: where you work and where you live shape the chances of getting ahead at least as much as how hard you work or how much education you have.',
  'Memphis': 'Memphis carries a structural mismatch on returns to education: master\'s-degree holders here have more than double the underemployment rate of their Nashville counterparts (13.4% vs 5.5%) — the single largest intra-credential gap in the data. The city produces or attracts graduate-credentialled workers but does not generate enough roles that require and reward those credentials. Younger workers feel this most acutely: 37.7% of Memphis 25–34-year-olds are stranded, against 27.2% in Nashville.',
  'Knoxville': 'Knoxville\'s wage strandedness is concentrated in specific sectors rather than spread evenly across the labour market. Accommodation and food services posts a 70.6% low-wage rate locally — the single highest sector-MSA combination in the dataset, 22pp above Memphis and 32pp above Nashville for the same sector. Utilities also shows an anomalous 10.9% underemployment rate against a 2.7% state norm, hinting at over-qualified workers absorbed into available technical roles for lack of alternatives.',
  'Chattanooga': 'Strandedness in Chattanooga is driven primarily by wage levels rather than qualification mismatch — underemployment sits at or below state norms in most sectors. Workers without a high-school diploma face an especially severe wage burden: 47.7% are low-wage in Chattanooga, against 36.7% in Nashville, reflecting limited entry-level progression infrastructure.',
  'Other MSA': 'Rural Tennessee and smaller MSAs carry the heaviest low-wage burden in the state. College-degree holders here face strandedness rates well above the urban average — not because they are overqualified in the abstract, but because their local economies simply do not generate enough roles that match what they can do. 27.4% of rural bachelor\'s-degree holders are stranded overall, 7pp above Nashville.',
  'All': 'Roughly one in four working Tennesseans is stranded. Geographic variation is one of the most striking findings in the report — Nashville sits notably below the rest of the state on low-wage strandedness, while Memphis, Knoxville, Chattanooga, and rural areas each show a distinct profile of where the problem concentrates.',
};

const REPORT_SECTOR_CONTEXT: Record<string, string> = {
  'Accommodation and Food Services': 'The most severely stranded sector in the state — 54.2% of workers are low-wage and a further 12.0% are underemployed. The wide dispersion in low-wage strandedness across sectors means industry of employment is one of the strongest single predictors of strandedness in Tennessee.',
  'Administrative and Support and Waste Management': 'Administrative and support services is one of the most stranded sectors statewide (33.4% low-wage), with Memphis the sharpest case at 46.0% — a 12pp gap above the state average that points to local wage-floor suppression.',
  'Retail Trade': 'Retail is among the most stranded sectors in the state. Knoxville posts an 11.3% retail underemployment rate (statewide retail: 7.0%), pointing to qualified workers absorbed into available roles in the absence of better local options.',
  'Health Care and Social Assistance': 'Healthcare is the most AI-resilient large sector in the state (52% average automation exposure, only 14% of workers in top-quartile high-exposure roles) — and the Healthcare Ladder is the highest-impact transition pathway by average wage gain. Tennessee already has the community college infrastructure to support these transitions at scale.',
  'Manufacturing': 'Manufacturing in Tennessee shows above-average underemployment in Memphis (7.3%), suggesting graduate-credentialled workers take available production roles in the absence of professional-tier demand. Statewide stalling rates in manufacturing run higher than service sectors (4.5% in Knoxville).',
  'Transportation and Warehousing': 'Transportation and warehousing has by far the highest share of workers in top-quartile AI-high-exposure occupations of any large sector (76%). In Nashville and the Other MSA category, more than 89% and 94% respectively of workers in this sector are in top-quartile AI-exposure roles — a notable finding for a state that has invested heavily in logistics infrastructure.',
  'Construction': 'Construction sits in the more AI-exposed half of Tennessee\'s sectoral profile (61% average automation exposure, 42% in top-quartile high-exposure occupations). Memphis construction also shows elevated low-wage rates (26.6%) relative to Nashville and the state overall.',
  'Information': 'Information shows a striking divergence by geography. Memphis posts a 19.9% underemployment rate — the highest of any MSA for the sector and more than 5× Nashville\'s rate — while rural Tennessee posts 14.6%. Together these patterns suggest the sector retains degree-holding workers without absorbing them into roles commensurate with their qualifications.',
  'Finance and Insurance': 'Finance and insurance sits at the lower end of Tennessee\'s strandedness spectrum (low-wage rate <11%) and is a frequent destination in the Professional & Financial Services pathway — one of the highest-impact destranding routes in the report.',
  'Wholesale Trade': 'Wholesale trade shows above-average low-wage strandedness in Memphis (34.6%) and is among the more AI-exposed sectors (60% average automation exposure).',
  'Professional, Scientific, and Technical Services': 'Professional, scientific and technical services sits at the lower-strandedness end of the state spectrum and is a common destination occupation in the Technology Pivot and Professional & Financial Services pathways.',
  'Public Administration': 'Public administration shows modest career stalling rates (5.0% in Knoxville, highest within that MSA) but is largely AI-resilient relative to the state average.',
  'Educational Services': 'Education contains a known structural mismatch: Teaching Assistants represent the largest single career-stalling cohort statewide (2,160 workers) while the Education Credentialing pathway shows very low observed transition volume — pointing to the absence of an accessible fast-track licensure route.',
  'Utilities': 'Utilities is normally a low-strandedness sector statewide, but Knoxville is an exception with a 10.9% underemployment rate against the state\'s 2.7% — flagging a specific skills mismatch at TVA or other area utilities employers.',
  'Real Estate and Rental and Leasing': 'Real estate and rental/leasing in rural Tennessee shows elevated low-wage (40.6%) and underemployment (11.0%) rates relative to other geographies.',
  'Arts, Entertainment, and Recreation': 'Arts, entertainment and recreation in rural Tennessee shows the highest low-wage rate of any rural sector (52.4%) and one of the highest underemployment rates in the dataset (21.4%) — reflecting seasonality, part-time work, and the absence of anchor employers.',
};

// ============================================================================
// APP LOADER — fetch the view store, then mount the dashboard
// ============================================================================

const App = () => {
  const [ready, setReady] = useState<boolean>(isReady());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready) return;
    let alive = true;
    initData().then(() => { if (alive) setReady(true); })
      .catch(e => { if (alive) setError(String(e?.message || e)); });
    return () => { alive = false; };
  }, [ready]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-8">
        <div className="max-w-md text-center">
          <p className="text-sm font-black text-red-600 uppercase tracking-widest mb-2">Failed to load dashboard data</p>
          <p className="text-xs text-slate-500">{error}</p>
          <p className="text-xs text-slate-400 mt-4">The view store (public/data/*.json) may be missing. Run the prebuild sync.</p>
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <LayoutDashboard size={32} className="text-blue-900 animate-pulse" />
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Loading Tennessee workforce data…</p>
        </div>
      </div>
    );
  }
  return <Dashboard />;
};

// ============================================================================
// DASHBOARD — the interactive explorer (mounts only after data is ready)
// ============================================================================

const Dashboard = () => {
  const meta = getMeta();
  const countyBoundaries = getCountyBoundaries();
  const SECTORS = meta.sectors;

  // --- State ---
  const [geography, setGeography] = useState<MSACategory>('All');
  const [sector, setSector] = useState<string>(SECTORS.includes('Manufacturing') ? 'Manufacturing' : SECTORS[0]);
  const [selectedCohort, setSelectedCohort] = useState<CohortType>('All Stranded');
  const [targetOccupation, setTargetOccupation] = useState<string | null>(null);
  const [expandedRec, setExpandedRec] = useState<number | null>(0);
  const [pathwayMode, setPathwayMode] = useState<'transitions' | 'similarity'>('transitions');
  const [selectedDestination, setSelectedDestination] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillsData | null>(null);

  // Lazily fetch the skills payload (largest file) once a destination is chosen.
  useEffect(() => {
    if (selectedDestination && !skills) loadSkills().then(setSkills).catch(() => {});
  }, [selectedDestination, skills]);

  // ============================================================================
  // DERIVED DATA — key lookups into the fetched view store (no aggregation here)
  // ============================================================================

  const sectors = SECTORS;
  const slice = getSlice(geography, sector);

  /** Aggregate stats for the selected geography x sector slice. Shapes preserved
   *  ({ total, lw, ue, st }) so downstream rendering is unchanged. */
  const stats = useMemo(() => ({
    total: Math.round(slice?.stats.total ?? 0),
    lw: Math.round(slice?.stats.low_wage ?? 0),
    ue: Math.round(slice?.stats.underemployed ?? 0),
    st: Math.round(slice?.stats.stalled ?? 0),
  }), [slice]);

  /** Occupational breakdown for the selected cohort — pre-sorted [name, value]. */
  const cohortBreakdowns = useMemo(() => ({
    occ: (slice?.cohorts?.[selectedCohort]?.top_occupations ?? []) as [string, number][],
  }), [slice, selectedCohort]);

  /** Stalled occupational mix + stall-duration histogram (pre-binned). */
  const stalledBreakdowns = useMemo(() => ({
    occMix: (slice?.cohorts?.['Stalled']?.top_occupations ?? []) as [string, number][],
    durations: (slice?.stalled?.durations ?? []) as [string, number][],
    durationSuppressed: slice?.stalled?.duration_suppressed ?? false,
  }), [slice]);

  /** Age + education breakdowns for the selected cohort (already ordered & resolved). */
  const demoBreakdowns = useMemo(() => {
    const demo = slice?.cohorts?.[selectedCohort]?.demographics;
    return {
      age: (demo?.age ?? []) as [string, number][],
      education: (demo?.education ?? []) as [string, number][],
    };
  }, [slice, selectedCohort]);

  // Auto-select the top occupation when filters change; clear when the slice is empty.
  useEffect(() => {
    if (cohortBreakdowns.occ.length > 0) {
      setTargetOccupation(cohortBreakdowns.occ[0][0]);
    } else {
      setTargetOccupation(null);
      setSelectedDestination(null);
    }
  }, [sector, selectedCohort, geography, cohortBreakdowns.occ]);

  // Reset destination when occupation or pathway mode changes
  useEffect(() => {
    setSelectedDestination(null);
    setExpandedRec(null);
  }, [targetOccupation, pathwayMode]);

  // --- Section 03: Occupation diagnostics from the reference store ---
  const occupationDiagnostics = useMemo(() => {
    if (!targetOccupation) return null;
    const r = getOccRef(targetOccupation);
    if (!r) return null;
    return {
      strandedShare: r.share_stranded ?? 0,
      medianWage: r.median_wage ?? 0,
      partTimeShare: r.share_part_time ?? 0,
      autoExposure: r.ai.auto_exposure,
      augExposure: r.ai.aug_exposure,
      useExposure: r.ai.usecase_exposure,
      impactPct: r.ai.impact_pct_baseline,
      headcountChange: r.ai.headcount_change_baseline,
      internalPromo5: r.internal_promotion_rate_5,
      externalPromo5: r.external_promotion_rate_5,
    };
  }, [targetOccupation]);

  // --- Section 04: Pathway destinations (top-5, pre-sorted in R) ---
  const originPaths = useMemo(() => (targetOccupation ? getPathways(targetOccupation) : undefined), [targetOccupation]);
  const isTransitionFallback = pathwayMode === 'transitions' && !!originPaths && originPaths.transitions.length === 0 && originPaths.similarity.length > 0;
  const destinationPathways: Destination[] = useMemo(() => {
    if (!originPaths) return [];
    if (pathwayMode === 'transitions') {
      return originPaths.transitions.length > 0 ? originPaths.transitions : originPaths.similarity;
    }
    return originPaths.similarity;
  }, [originPaths, pathwayMode]);

  // --- Skill gaps for selected origin → destination ---
  const selectedSkillGaps = useMemo(() => {
    if (!skills || !targetOccupation || !selectedDestination) return [];
    const pair = skills.by_pair[`${targetOccupation}|${selectedDestination}`];
    if (!pair) return [];
    return [...pair.gaps]
      .filter(g => (g.skill_gap ?? 0) > 0)
      .sort((a, b) => (b.skill_gap ?? 0) - (a.skill_gap ?? 0))
      .slice(0, 5);
  }, [skills, targetOccupation, selectedDestination]);

  // --- Credential-related skills from job postings (client-side over fetched gaps) ---
  const credentialSkills = useMemo(() => {
    if (!skills || !targetOccupation || !selectedDestination) return [];
    const pair = skills.by_pair[`${targetOccupation}|${selectedDestination}`];
    if (!pair) return [];
    return pair.gaps
      .filter(g => (g.skill_gap ?? 0) > 0)
      .filter(g => CREDENTIAL_PATTERNS.some(p => p.test(g.skill)))
      .filter(g => isCredentialRelevantToOccupation(g.skill, selectedDestination))
      .sort((a, b) => (b.destination_importance ?? 0) - (a.destination_importance ?? 0));
  }, [skills, targetOccupation, selectedDestination]);

  // --- Cross-pathway skill acquisition (pre-computed subcategory aggregations) ---
  const crossPathwaySkills = useMemo(() => {
    if (!skills || !targetOccupation) return [];
    const rows = skills.cross_pathway[targetOccupation] ?? [];
    return [...rows]
      .sort((a, b) => b.n_destination_occs - a.n_destination_occs || (b.avg_skill_gap ?? 0) - (a.avg_skill_gap ?? 0))
      .slice(0, 5)
      .map(r => ({ skill: r.skill, count: r.n_destination_occs, totalDests: r.total_destination_occs, importance: r.avg_skill_gap ?? 0 }));
  }, [skills, targetOccupation]);

  // --- Selected destination row (for sidebar metrics) ---
  const selectedDestRow = useMemo(() => {
    if (!originPaths || !selectedDestination) return null;
    return originPaths.transitions.find(d => d.name === selectedDestination)
      || originPaths.similarity.find(d => d.name === selectedDestination)
      || null;
  }, [originPaths, selectedDestination]);

  // ============================================================================
  // EXPORT EXECUTIVE BRIEF
  // ============================================================================

  const handleExportBrief = () => {
    const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

    const renderReportBar = (label: string, value: number, max: number, color: string = '#1e3a8a') => `
      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 5px;">
          <span style="max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(label)}</span><span>${Math.round(value).toLocaleString()}</span>
        </div>
        <div style="height: 7px; width: 100%; background: #f1f5f9; border-radius: 4px; overflow: hidden;">
          <div style="height: 100%; width: ${max > 0 ? (value / max) * 100 : 0}%; background: ${color}; border-radius: 4px;"></div>
        </div>
      </div>`;

    const maxOcc = Math.max(...cohortBreakdowns.occ.map(x => x[1]), 1);
    const totalStranded = stats.lw + stats.ue + stats.st;
    const strandedPct = stats.total > 0 ? (totalStranded / stats.total) * 100 : 0;

    const geoLabel = geography === 'All' ? 'Tennessee (statewide)' : geography === 'Other MSA' ? OTHER_MSA_LABEL : REGION_GEOS.has(geography) ? `${geography} Tennessee` : `${geography} MSA`;
    const geoContext = REPORT_GEO_CONTEXT[geography] || '';
    const sectorContext = REPORT_SECTOR_CONTEXT[sector] || '';

    // Demographics for this geo×sector cohort (pre-resolved, ordered [label, value] pairs)
    const demo = slice?.cohorts?.[selectedCohort]?.demographics;
    const ageBuckets = (demo?.age ?? []).filter(([, v]) => v > 0) as [string, number][];
    const eduBuckets = (demo?.education ?? []).filter(([, v]) => v > 0) as [string, number][];
    const maxAge = Math.max(...ageBuckets.map(([, v]) => v), 1);
    const maxEdu = Math.max(...eduBuckets.map(([, v]) => v), 1);

    // Displacement risk for top occupations in this slice
    const topOccs = cohortBreakdowns.occ.slice(0, 6);
    const topOccsWithAI = topOccs.map(([occ, val]) => {
      const r = getOccRef(occ);
      const s = scoreAI(r?.ai.auto_exposure, r?.ai.aug_exposure, r?.ai.impact_pct_baseline);
      return { occ, workers: Math.round(val), score: s };
    });
    const highRiskOccs = topOccsWithAI.filter(o => o.score.band === 'high');
    const highRiskWorkers = highRiskOccs.reduce((s, o) => s + o.workers, 0);
    const highRiskShare = totalStranded > 0 ? Math.round((highRiskWorkers / totalStranded) * 100) : 0;

    const bandHex = (b: AIBand) => b === 'high' ? '#dc2626' : b === 'med' ? '#d97706' : b === 'low' ? '#059669' : '#94a3b8';
    const bandShort = (b: AIBand) => b === 'high' ? 'High Risk' : b === 'med' ? 'Soft Decline' : b === 'low' ? 'Stable/Growing' : '—';

    const topPathways = destinationPathways.slice(0, 5);
    const briefDate = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

    const reportHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>Executive Brief: Stranded Talent — ${esc(geoLabel)} · ${esc(sector)}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800;900&display=swap');
        * { box-sizing: border-box; } body { font-family: 'Inter', sans-serif; padding: 0; margin: 0; color: #1e293b; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { padding: 50px 60px 80px 60px; min-height: 100vh; page-break-after: always; position: relative; }
        .header { border-bottom: 4px solid #1e3a8a; padding-bottom: 16px; margin-bottom: 26px; display: flex; justify-content: space-between; align-items: flex-end; }
        .header h1 { margin: 0; text-transform: uppercase; font-size: 22px; color: #1e3a8a; font-weight: 900; letter-spacing: -0.025em; line-height: 1.1; }
        .header .meta { text-align: right; font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1.7; }
        h2 { color: #1e3a8a; border-left: 6px solid #f59e0b; padding-left: 12px; text-transform: uppercase; font-size: 13px; margin: 0 0 14px 0; font-weight: 900; letter-spacing: 0.02em; }
        .phase { margin: 0 0 6px 0; font-size: 10px; font-weight: 800; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.1em; }
        .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 22px; }
        .stat-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; text-align: center; }
        .stat-val { font-size: 24px; font-weight: 900; color: #1e40af; display: block; letter-spacing: -0.04em; }
        .stat-label { font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; display: block; margin-bottom: 6px; }
        .narrative { font-size: 12px; line-height: 1.65; color: #334155; margin: 0 0 18px 0; }
        .narrative .quote { display: block; border-left: 3px solid #f59e0b; background: #fffbeb; padding: 12px 14px; border-radius: 8px; font-size: 11px; line-height: 1.6; color: #475569; margin: 14px 0; font-weight: 500; }
        .col-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
        .panel-h { font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 12px 0; }
        .rec-card { background: #1e3a8a; color: white; padding: 22px; border-radius: 14px; margin-bottom: 12px; page-break-inside: avoid; }
        .rec-card h3 { color: #f59e0b; margin: 0 0 6px 0; text-transform: uppercase; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; }
        .rec-title { font-size: 15px; font-weight: 800; margin: 0 0 10px 0; color: #fef3c7; }
        .rec-row { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11px; line-height: 1.5; color: #cbd5e1; }
        .rec-pill { font-size: 9px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: rgba(245, 158, 11, 0.18); color: #fef3c7; text-transform: uppercase; letter-spacing: 0.05em; }
        .recs-list { background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px 22px; border-radius: 12px; }
        .recs-list li { font-size: 12px; line-height: 1.65; color: #334155; margin-bottom: 8px; }
        .recs-list strong { color: #1e3a8a; }
        .footer { position: absolute; bottom: 30px; left: 60px; right: 60px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 8px; color: #94a3b8; text-align: center; font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em; }
        @media print { .page { min-height: 100vh; height: auto; } .rec-card, .recs-list { page-break-inside: avoid; } }
      </style></head><body>

      <!-- PAGE 1: Diagnostic at the intersection -->
      <div class="page">
        <div class="header"><div>
          <p class="phase">Phase I · Diagnostic Inventory</p>
          <h1>${esc(geoLabel)} &middot; ${esc(sector)}</h1>
        </div><div class="meta">Cohort: ${esc(selectedCohort)}<br>Briefing date: ${esc(briefDate)}</div></div>

        <div class="stat-grid">
          <div class="stat-box"><span class="stat-label">Total Workforce</span><span class="stat-val">${stats.total.toLocaleString()}</span></div>
          <div class="stat-box"><span class="stat-label">Stranded</span><span class="stat-val">${totalStranded.toLocaleString()}</span></div>
          <div class="stat-box"><span class="stat-label">Stranded Rate</span><span class="stat-val">${strandedPct.toFixed(0)}%</span></div>
          <div class="stat-box"><span class="stat-label">In High-Risk AI Roles</span><span class="stat-val">${highRiskShare}%</span></div>
        </div>

        <h2>What this slice looks like</h2>
        <p class="narrative">
          Across ${esc(geoLabel)}'s ${esc(sector)} sector, <strong>${totalStranded.toLocaleString()} workers</strong> (${strandedPct.toFixed(1)}% of the local sector workforce) meet at least one stranded-talent definition: ${stats.lw.toLocaleString()} low-wage, ${stats.ue.toLocaleString()} underemployed, and ${Math.round(stats.st).toLocaleString()} career-stalled. Of those, roughly <strong>${highRiskShare}% sit in occupations where BGI projects ≥5% employer-demand decline over the next five years</strong> — the report's "double-jeopardy" population, currently stranded and in roles where AI-driven adoption is on track to materially reduce demand for the worker's labour.
        </p>

        ${geoContext ? `<p class="narrative"><strong style="color: #1e3a8a; text-transform: uppercase; font-size: 10px; letter-spacing: 0.1em;">${esc(geography === 'All' ? 'Statewide context' : geoDisplay(geography) + ' context')}</strong><span class="quote">${esc(geoContext)}</span></p>` : ''}
        ${sectorContext ? `<p class="narrative"><strong style="color: #1e3a8a; text-transform: uppercase; font-size: 10px; letter-spacing: 0.1em;">Sector context</strong><span class="quote">${esc(sectorContext)}</span></p>` : ''}

        <div class="footer">Tennessee BGI Strategic Workforce Initiative · ${esc(geoLabel)} · ${esc(sector)} · Page 1 / 3</div>
      </div>

      <!-- PAGE 2: Who they are -->
      <div class="page">
        <div class="header"><div>
          <p class="phase">Phase I · Demographic Composition</p>
          <h1>${esc(selectedCohort)} workers in ${esc(geoLabel)} ${esc(sector)}</h1>
        </div><div class="meta">${ageBuckets.length > 0 ? 'Source: BGI cross-tab of ACS microdata' : ''}</div></div>

        <div class="col-2">
          <div>
            <p class="panel-h">Top occupational concentrations</p>
            ${cohortBreakdowns.occ.slice(0, 10).map(([l, v]) => renderReportBar(l, v, maxOcc, '#1e3a8a')).join('')}
          </div>
          <div>
            ${ageBuckets.length > 0 ? `
              <p class="panel-h">Age distribution</p>
              ${ageBuckets.map(([l, v]) => renderReportBar(l, v, maxAge, '#10b981')).join('')}
            ` : ''}
            ${eduBuckets.length > 0 ? `
              <p class="panel-h" style="margin-top: 22px;">Education attainment</p>
              ${eduBuckets.map(([l, v]) => renderReportBar(l, v, maxEdu, '#f59e0b')).join('')}
            ` : ''}
          </div>
        </div>

        ${topOccsWithAI.some(o => o.score.band !== 'none') ? `
        <h2 style="margin-top: 26px;">5-year AI demand outlook across the top stranded occupations</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
          <thead><tr style="text-align: left; color: #64748b; text-transform: uppercase; font-size: 9px; letter-spacing: 0.1em; font-weight: 800;">
            <th style="padding: 8px 6px; border-bottom: 1px solid #e2e8f0;">Occupation</th>
            <th style="padding: 8px 6px; border-bottom: 1px solid #e2e8f0; text-align: right;">${esc(selectedCohort)} workers</th>
            <th style="padding: 8px 6px; border-bottom: 1px solid #e2e8f0; text-align: right;">5yr demand</th>
            <th style="padding: 8px 6px; border-bottom: 1px solid #e2e8f0; text-align: right;">Auto / Aug task scores</th>
            <th style="padding: 8px 6px; border-bottom: 1px solid #e2e8f0; text-align: right;">Band</th>
          </tr></thead>
          <tbody>
          ${topOccsWithAI.map(o => `<tr>
            <td style="padding: 6px; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${esc(o.occ)}</td>
            <td style="padding: 6px; border-bottom: 1px solid #f1f5f9; text-align: right; color: #475569;">${o.workers.toLocaleString()}</td>
            <td style="padding: 6px; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: 800; color: ${bandHex(o.score.band)};">${o.score.impactPct !== null ? `${o.score.impactPct >= 0 ? '+' : ''}${o.score.impactPct.toFixed(1)}%` : '—'}</td>
            <td style="padding: 6px; border-bottom: 1px solid #f1f5f9; text-align: right; color: #94a3b8;">${o.score.auto !== null ? `${Math.round(o.score.auto * 100)}% / ${o.score.aug !== null ? Math.round(o.score.aug * 100) : '—'}%` : '—'}</td>
            <td style="padding: 6px; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: 800;"><span style="background: ${bandHex(o.score.band)}; color: white; padding: 2px 8px; border-radius: 999px; font-size: 10px;">${bandShort(o.score.band)}</span></td>
          </tr>`).join('')}
          </tbody>
        </table>
        <p style="font-size: 10px; color: #94a3b8; margin-top: 8px; font-style: italic;">5yr demand = BGI's demand-adjusted projection of employer need for the occupation, accounting for AI adoption pace, demand elasticity, and physical-task constraints. High Risk = projected ≤ −5% · Soft Decline = −5% to −2% · Stable/Growing = &gt; −2%.</p>
        ` : ''}

        <div class="footer">Tennessee BGI Strategic Workforce Initiative · ${esc(geoLabel)} · ${esc(sector)} · Page 2 / 3</div>
      </div>

      <!-- PAGE 3: Pathways and recommendations -->
      <div class="page">
        <div class="header"><div>
          <p class="phase">Phase II · Recommended Pathways</p>
          <h1>${targetOccupation ? esc(targetOccupation) : 'Pathway destinations'}</h1>
        </div><div class="meta">Pathway mode: ${esc(pathwayMode === 'transitions' ? 'Observed transitions' : 'Skill similarity')}</div></div>

        ${targetOccupation ? `<p class="narrative">
          Career pathway analysis for <strong>${esc(targetOccupation)}</strong> in ${esc(geoLabel)}. Destinations below combine BGI-observed transition flows with high-similarity skill matches; each is shown with its wage gain, similarity rating, and AI exposure profile so policymakers can pick durable pathways.
        </p>` : '<p class="narrative">No focus occupation selected. Choose an occupation in the dashboard to generate a tailored pathway page.</p>'}

        ${topPathways.map((p, i) => {
          const sDest = scoreAI(p.ai.auto_exposure, p.ai.aug_exposure, p.ai.impact_pct_baseline);
          const intP = p.internal_promotion_rate_5;
          const wg = p.wage_gain_median ?? 0;
          const wgp = p.wage_gain_median_pct ?? 0;
          const ds = p.diff_strandedness ?? 0;
          return `<div class="rec-card">
            <h3>Destination ${String(i + 1).padStart(2, '0')}${p.similarity_rating ? ` · ${esc(p.similarity_rating.charAt(0).toUpperCase() + p.similarity_rating.slice(1))} similarity` : ''}</h3>
            <p class="rec-title">${esc(p.name)}</p>
            <div class="rec-row">
              <span><strong style="color: #fef3c7;">Wage gain:</strong> +$${Math.round(wg).toLocaleString()} (${Math.round(wgp * 100)}%)</span>
              <span><strong style="color: #fef3c7;">Strandedness change:</strong> ${Math.round(ds * 100)}%</span>
              <span><strong style="color: #fef3c7;">TN demand:</strong> ${esc(p.demand_category || 'N/A')}</span>
              ${sDest.band !== 'none' && sDest.impactPct !== null ? `<span class="rec-pill" style="background: ${bandHex(sDest.band)}; color: white;">${bandShort(sDest.band)} · ${sDest.impactPct >= 0 ? '+' : ''}${sDest.impactPct.toFixed(0)}% 5yr</span>` : ''}
              ${(intP !== undefined && intP !== null) ? `<span class="rec-pill">Internal promo ${Math.round(intP * 100)}%</span>` : ''}
            </div>
          </div>`;
        }).join('')}

        <h2 style="margin-top: 22px;">Strategic implications</h2>
        <ul class="recs-list">
          ${strandedPct >= 25 ? `<li><strong>Sector triage.</strong> ${esc(sector)} in ${esc(geoLabel)} runs above the statewide ~25% strandedness baseline. Prioritise this intersection for credential-pathway investment.</li>` : `<li><strong>Below-baseline slice.</strong> ${esc(sector)} in ${esc(geoLabel)} sits at ${strandedPct.toFixed(0)}% strandedness, below the statewide baseline — interventions should focus on the specific stranded subpopulations identified on page 2 rather than blanket sector treatments.</li>`}
          ${highRiskShare >= 30 ? `<li><strong>Double-jeopardy concentration.</strong> ${highRiskShare}% of stranded workers in this slice sit in high net displacement-risk occupations — meaning automation outweighs augmentation by 10+ percentage points. Pathway choices that route into low-risk destinations (healthcare ladder, professional/financial services) compound returns: immediate strandedness relief plus durable insulation from disruption.</li>` : `<li><strong>Manageable displacement risk.</strong> Only ${highRiskShare}% of stranded workers in this slice sit in high net displacement-risk occupations — most face AI as a tool that augments rather than replaces. Strandedness here is more a pay/utilisation question than an AI-disruption question.</li>`}
          <li><strong>Pathway architecture.</strong> The report identifies seven destranding pathway types. For this slice, the most relevant typically include the Healthcare Ladder (highest wage gain, lowest AI exposure), Professional & Financial Services (highest strandedness reduction), and Project & Operations Management (most credential-accessible, sector-agnostic).</li>
          <li><strong>Within-occupation lever.</strong> Promotion-rate and full-time-share data on page 2 indicate that, for some occupations, scaling part-time hours up to full-time and supporting internal promotion are credible alternatives to a full pathway switch. These are lower-cost interventions.</li>
        </ul>

        <div class="footer">Tennessee BGI Strategic Workforce Initiative · ${esc(geoLabel)} · ${esc(sector)} · Page 3 / 3</div>
      </div>

      <script>setTimeout(function(){ window.print(); }, 600);</script></body></html>`;

    const win = window.open('', '_blank');
    win?.document.write(reportHtml);
    win?.document.close();
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  const treemapTotal = stats.lw + stats.ue + stats.st;
  const treemapItems: { key: CohortType; label: string; value: number; pct: number | null; color: string; selectedColor: string; textColor: string; tooltip: string }[] = [
    {
      key: 'Low Wage', label: 'Low Wage', value: stats.lw,
      pct: treemapTotal > 0 ? (stats.lw / treemapTotal) * 100 : null,
      color: 'bg-blue-100 border-blue-200', selectedColor: 'bg-blue-600 border-blue-700',
      textColor: 'text-blue-900', tooltip: 'Workers earning annual wages below $30,493 (two-thirds of MIT Living Wage for Tennessee). These workers struggle to meet basic living expenses despite being employed.'
    },
    {
      key: 'Underemployed', label: 'Underemployed', value: stats.ue,
      pct: treemapTotal > 0 ? (stats.ue / treemapTotal) * 100 : null,
      color: 'bg-amber-100 border-amber-200', selectedColor: 'bg-amber-500 border-amber-600',
      textColor: 'text-amber-900', tooltip: 'Workers whose education exceeds their job requirements by 2+ levels (Associate\'s or below) or 1+ level (Bachelor\'s or above), AND earning $45,739 or less annually.'
    },
    {
      key: 'Stalled', label: 'Career Stalled', value: Math.round(stats.st),
      pct: treemapTotal > 0 ? (stats.st / treemapTotal) * 100 : null,
      color: 'bg-emerald-100 border-emerald-200', selectedColor: 'bg-emerald-500 border-emerald-600',
      textColor: 'text-emerald-900', tooltip: 'Workers who have remained in the same low-wage job for 3+ years without meaningful wage progression. Economically stuck — employed but unable to advance.'
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-20 font-['Inter']">
      {/* ================================================================
          NAV BAR
          ================================================================ */}
      <nav className="bg-[#1E3A8A] text-white py-4 px-4 md:py-6 md:px-10 shadow-xl sticky top-0 z-50 flex flex-col md:flex-row items-start md:items-center justify-between border-b-4 border-amber-500 gap-4 md:gap-0">
        <div className="flex items-center gap-3 md:gap-5">
          <div className="p-2 md:p-3 bg-white/10 rounded-2xl shadow-inner backdrop-blur-md">
            <LayoutDashboard size={24} className="md:w-7 md:h-7" />
          </div>
          <div>
            <h1 className="text-lg md:text-2xl font-black uppercase tracking-tighter">Stranded Talent Interactive</h1>
            <p className="text-[9px] md:text-[10px] font-bold text-amber-400 uppercase tracking-widest mt-1">Tennessee BGI Policy Dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3 w-full md:w-auto">
          {/* Report download is gated on VITE_REPORT_DOCX (built into the public site only once the
              .docx is cleared for public release + committed alongside it). Hidden by default. */}
          {(import.meta as any).env?.VITE_REPORT_DOCX === '1' && (
          <a href={`${(import.meta as any).env?.BASE_URL || '/'}Mobilizing-Stranded-Talent-Report.docx`} download
            className="flex items-center gap-2 md:gap-3 bg-amber-500 hover:bg-amber-400 text-blue-950 px-4 py-2 md:px-6 md:py-3 rounded-2xl font-black text-xs uppercase transition-all shadow-xl active:scale-95 group flex-1 md:flex-none justify-center"
            title="Download the full 'Mobilizing Stranded Talent' research report (Word document)">
            <FileText size={16} className="md:w-[18px] md:h-[18px] group-hover:translate-y-0.5 transition-transform" />
            <span className="hidden sm:inline">Download Full Report</span><span className="sm:hidden">Full Report</span>
          </a>
          )}
          <button onClick={handleExportBrief}
            className="flex items-center gap-2 md:gap-3 bg-white hover:bg-slate-100 text-blue-950 px-4 py-2 md:px-6 md:py-3 rounded-2xl font-black text-xs uppercase transition-all shadow-xl active:scale-95 group flex-1 md:flex-none justify-center">
            <Download size={16} className="md:w-[18px] md:h-[18px] group-hover:translate-y-0.5 transition-transform" />
            <span className="hidden sm:inline">Export Executive Brief</span><span className="sm:hidden">Export Brief</span>
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 md:px-10 py-8 md:py-12 space-y-12 md:space-y-24">

        {/* ================================================================
            SECTION 01: REGIONAL & SECTOR SCOPE
            ================================================================ */}
        <section className="space-y-6 md:space-y-10">
          <div className="flex items-center gap-3 md:gap-4 border-b-2 border-slate-200 pb-4 md:pb-6">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl md:rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs md:text-sm shadow-inner flex-shrink-0">01</div>
            <div>
              <h2 className="text-base md:text-xl font-black text-slate-800 uppercase tracking-tight leading-none">Regional & Sector Scope</h2>
              <p className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 md:mt-2">Baseline Diagnostic Definition</p>
            </div>
          </div>
          <div className="space-y-6 md:space-y-8">
            {/* Full-width map */}
            <div className="bg-white p-6 md:p-10 rounded-[24px] md:rounded-[40px] shadow-sm border border-slate-200">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 md:mb-8 flex items-center gap-2">
                <MapPin size={12} className="text-blue-500" /> Geography
                <span className="ml-auto text-[9px] font-bold text-slate-400 tracking-wider normal-case">Click a region to filter</span>
              </h4>
              <div className="max-w-5xl mx-auto">
                <TennesseeMap selectedRegion={geography} onRegionClick={setGeography as (r: any) => void} countyBoundaries={countyBoundaries} />
              </div>
            </div>

            {/* Sector selector + stat tiles row */}
            <div className="bg-white p-5 md:p-8 rounded-[24px] md:rounded-[40px] shadow-sm border border-slate-200">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 items-stretch">
                <div className="lg:col-span-6">
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Briefcase size={14} className="text-blue-500" /> NAICS Sector
                  </label>
                  <div className="relative">
                    <select value={sector} onChange={(e) => setSector(e.target.value)}
                      className="w-full bg-[#F8FAFC] border-2 border-slate-100 rounded-[20px] px-6 py-4 text-sm font-black appearance-none focus:border-blue-500 transition-all outline-none pr-14">
                      {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"><ChevronDown size={20} /></div>
                  </div>
                </div>
                <div className="lg:col-span-3 p-5 bg-blue-900 rounded-[20px] text-white flex flex-col justify-center">
                  <p className="text-[10px] font-black text-blue-300 uppercase tracking-widest mb-1">Total Workers</p>
                  <p className="text-2xl md:text-3xl font-black">{stats.total.toLocaleString()}</p>
                </div>
                <div className="lg:col-span-3 p-5 bg-amber-500 rounded-[20px] text-blue-950 flex flex-col justify-center">
                  <p className="text-[10px] font-black text-blue-950/40 uppercase tracking-widest mb-1">Stranded Rate</p>
                  <p className="text-2xl md:text-3xl font-black">{stats.total > 0 ? `${(((stats.lw + stats.ue + stats.st) / stats.total) * 100).toFixed(0)}%` : '—'}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            SECTION 02: THE STRANDED LANDSCAPE (Treemap + Diagnostics)
            ================================================================ */}
        <section className="space-y-6 md:space-y-10">
          <div className="flex items-center gap-3 md:gap-4 border-b-2 border-slate-200 pb-4 md:pb-6">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl md:rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs md:text-sm shadow-inner flex-shrink-0">02</div>
            <div>
              <h2 className="text-base md:text-xl font-black text-slate-800 uppercase tracking-tight leading-none">The Stranded Landscape</h2>
              <p className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 md:mt-2">Mutually Exclusive Cohort Identification</p>
            </div>
          </div>

          {/* Compact 3-cohort row across the top + 'All' toggle */}
          <div className="bg-white p-5 md:p-6 rounded-[24px] md:rounded-[32px] shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <BarChart3 size={12} className="text-blue-500" /> Stranded Worker Cohorts
              </h4>
              <button onClick={() => setSelectedCohort('All Stranded')}
                className={`text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full transition-all ${
                  selectedCohort === 'All Stranded' ? 'bg-blue-900 text-white shadow' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
                All ({Math.round(treemapTotal).toLocaleString()})
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
              {(() => {
                const maxVal = Math.max(...treemapItems.map(t => t.value), 1);
                const barFill: Record<string, string> = {
                  'Low Wage': 'bg-blue-500',
                  'Underemployed': 'bg-amber-500',
                  'Career Stalled': 'bg-emerald-500',
                };
                const activeBorder: Record<string, string> = {
                  'Low Wage': 'border-blue-500',
                  'Underemployed': 'border-amber-500',
                  'Career Stalled': 'border-emerald-500',
                };

                return treemapItems.map(item => {
                  const isExact = selectedCohort === item.key;
                  const isAll = selectedCohort === 'All Stranded';
                  const barWidth = (item.value / maxVal) * 100;

                  return (
                    <div key={item.key}
                      onClick={() => setSelectedCohort(item.key)}
                      className={`relative group cursor-pointer p-4 rounded-2xl border-2 transition-all duration-200 ${
                        isExact
                          ? `bg-white ${activeBorder[item.label]} shadow-md`
                          : 'bg-slate-50 border-transparent hover:bg-white hover:border-slate-200 hover:shadow-sm'
                      } ${!isExact && !isAll ? 'opacity-60 hover:opacity-100' : ''}`}>

                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">{item.label}</span>
                        {item.pct !== null && <span className="text-[10px] font-bold text-slate-400">{item.pct.toFixed(0)}%</span>}
                      </div>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-xl md:text-2xl font-black text-slate-800 tabular-nums">{Math.round(item.value).toLocaleString()}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${barFill[item.label]}`} style={{ width: `${barWidth}%` }} />
                      </div>

                      {/* Tooltip */}
                      <div className="invisible group-hover:visible absolute z-50 w-64 p-3 bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-700 bottom-full mb-2 left-1/2 -translate-x-1/2 pointer-events-none">
                        <div className="text-[10px] font-black uppercase tracking-wider text-amber-400 mb-1">{item.label}</div>
                        <div className="text-xs leading-relaxed">{item.tooltip}</div>
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-l-transparent border-r-8 border-r-transparent border-t-8 border-t-slate-900" />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Share of sector workforce</p>
              <p className="text-[10px] font-black text-slate-600">
                {stats.total > 0 ? `${(((stats.lw + stats.ue + stats.st) / stats.total) * 100).toFixed(1)}% stranded` : 'No workers in this selection'}
              </p>
            </div>
          </div>

          {/* Diagnostics panel — full-width below, 3 columns inside */}
          <div className="bg-white p-6 md:p-10 rounded-[24px] md:rounded-[40px] shadow-sm border border-slate-200">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-5 md:mb-6">Diagnostics: {selectedCohort}</h4>

            {selectedCohort === 'Stalled' ? (
              // Stalled: occupational mix + stall duration histogram
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
                <div>
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                    <Briefcase size={14} className="text-emerald-500" /> Stalled Occupational Mix
                  </p>
                  <div className="space-y-3">
                    {stalledBreakdowns.occMix.length > 0
                      ? stalledBreakdowns.occMix.slice(0, 8).map(([label, val]) => (
                          <ProgressBar key={label} label={label} value={Math.round(val)}
                            max={Math.round(stalledBreakdowns.occMix[0][1])}
                            colorClass="bg-emerald-500" />
                        ))
                      : <p className="text-xs text-slate-400 italic">No workers in this selection.</p>}
                  </div>
                </div>
                {!stalledBreakdowns.durationSuppressed && (
                  <div>
                    <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                      <TrendingUp size={14} className="text-emerald-700"/> Stall Duration
                    </p>
                    <div className="space-y-3">
                      {stalledBreakdowns.durations.some(([, v]) => (v as number) > 0)
                        ? (() => {
                            const maxDur = Math.max(...stalledBreakdowns.durations.map(([, v]) => v as number), 1);
                            return stalledBreakdowns.durations.map(([label, val]) => (
                              <ProgressBar key={label} label={label} value={Math.round(val as number)} max={Math.round(maxDur)} colorClass="bg-emerald-700" />
                            ));
                          })()
                        : <p className="text-xs text-slate-400 italic">No stall-duration data for this selection.</p>}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // Low Wage / Underemployed / All Stranded: 3 columns — occ | age | edu
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-10">
                <div>
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                    <Briefcase size={14} className="text-blue-500" /> Occupational Distribution
                  </p>
                  <div className="space-y-3">
                    {cohortBreakdowns.occ.length > 0
                      ? cohortBreakdowns.occ.slice(0, 8).map(([label, val]) => (
                          <ProgressBar key={label} label={label} value={Math.round(val)}
                            max={Math.round(cohortBreakdowns.occ[0][1])}
                            colorClass="bg-blue-500" />
                        ))
                      : <p className="text-xs text-slate-400 italic">No workers in this selection.</p>}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                    <Users size={14} className="text-emerald-500" /> Age Distribution
                  </p>
                  <div className="space-y-3">
                    {demoBreakdowns.age.length > 0 && demoBreakdowns.age.some(([, v]) => v > 0)
                      ? (() => {
                          const maxA = Math.max(...demoBreakdowns.age.map(([, v]) => v), 1);
                          return demoBreakdowns.age.map(([label, val]) => (
                            <ProgressBar key={label} label={label} value={Math.round(val)} max={Math.round(maxA)} colorClass="bg-emerald-500" />
                          ));
                        })()
                      : <p className="text-xs text-slate-400 italic">No age data for this slice.</p>}
                  </div>
                </div>
                <div className="md:col-span-2 lg:col-span-1">
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                    <GraduationCap size={14} className="text-amber-500" /> Education Attainment
                  </p>
                  <div className="space-y-3">
                    {demoBreakdowns.education.length > 0 && demoBreakdowns.education.some(([, v]) => v > 0)
                      ? (() => {
                          const maxE = Math.max(...demoBreakdowns.education.map(([, v]) => v), 1);
                          return demoBreakdowns.education.map(([label, val]) => (
                            <ProgressBar key={label} label={label} value={Math.round(val)} max={Math.round(maxE)} colorClass="bg-amber-500" />
                          ));
                        })()
                      : <p className="text-xs text-slate-400 italic">No education data for this slice.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ================================================================
            SECTION 03: OCCUPATIONAL SELECTION
            ================================================================ */}
        <section className="space-y-6 md:space-y-10">
          <div className="flex items-center gap-3 md:gap-4 border-b-2 border-slate-200 pb-4 md:pb-6">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl md:rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs md:text-sm shadow-inner flex-shrink-0">03</div>
            <div>
              <h2 className="text-base md:text-xl font-black text-slate-800 uppercase tracking-tight leading-none">Occupational Selection</h2>
              <p className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 md:mt-2">Drill-Down to Targeted Intervention Nodes</p>
            </div>
          </div>

          <div className="bg-white p-6 md:p-12 rounded-[24px] md:rounded-[40px] shadow-sm border border-slate-200">
            {cohortBreakdowns.occ.length === 0 ? (
              <div className="text-center py-8 md:py-10">
                <p className="text-sm font-black text-slate-500 uppercase tracking-widest">No occupation data for this slice</p>
                <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">The crosstab does not contain workers for <span className="font-bold text-slate-600">{geography === 'All' ? 'Tennessee' : geoDisplay(geography)}</span> · <span className="font-bold text-slate-600">{sector}</span>. Pick a different geography or sector to continue.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 md:gap-6">
                {cohortBreakdowns.occ.slice(0, 10).map(([occ, val]) => (
                  <div key={occ} onClick={() => setTargetOccupation(occ)}
                    className={`p-5 md:p-6 rounded-[24px] md:rounded-[32px] border-2 cursor-pointer transition-all duration-300 group relative ${
                      targetOccupation === occ ? 'bg-blue-900 border-blue-900 shadow-xl -translate-y-1' : 'bg-white border-slate-100 hover:border-blue-300'}`}>
                    <WordClampedText text={occ} className={`font-black uppercase tracking-tighter text-[10px] md:text-xs leading-[1.5] h-[4.5em] overflow-hidden mb-3 md:mb-4 ${targetOccupation === occ ? 'text-blue-200' : 'text-slate-800'}`} />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-56 text-center z-50 shadow-lg leading-relaxed normal-case font-normal tracking-normal">
                      {occ}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`text-[9px] md:text-[10px] font-black uppercase tracking-widest ${targetOccupation === occ ? 'text-blue-400' : 'text-slate-400'}`}>
                        {selectedCohort === 'All Stranded' ? 'Stranded Workers' : `${selectedCohort} Workers`}
                      </span>
                      <span className={`text-base md:text-lg font-black ${targetOccupation === occ ? 'text-white' : 'text-blue-950'}`}>{Math.round(val).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Occupation Diagnostic Panel */}
            {targetOccupation && occupationDiagnostics && (
              <div className="mt-6 md:mt-8 pt-6 md:pt-8 border-t border-slate-100">
                <p className="text-[10px] md:text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4 md:mb-6 flex items-center gap-2">
                  <Target size={14} className="text-blue-500" /> Occupation Diagnostics: {targetOccupation}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
                  <div className="p-4 md:p-6 bg-slate-50 rounded-[20px] md:rounded-[24px] border border-slate-100">
                    <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Stranded Share</p>
                    <p className="text-xl md:text-2xl font-black text-blue-900">{(occupationDiagnostics.strandedShare * 100).toFixed(1)}%</p>
                    <p className="text-[9px] text-slate-400 mt-1">of workers in this occupation are stranded</p>
                  </div>
                  <div className="p-4 md:p-6 bg-slate-50 rounded-[20px] md:rounded-[24px] border border-slate-100">
                    <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Median Wage</p>
                    <p className="text-xl md:text-2xl font-black text-blue-900">${occupationDiagnostics.medianWage.toLocaleString()}</p>
                    <p className="text-[9px] text-slate-400 mt-1">annual median for this occupation</p>
                  </div>
                  <div className="p-4 md:p-6 bg-slate-50 rounded-[20px] md:rounded-[24px] border border-slate-100 group relative">
                    <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Part-Time Share</p>
                    <p className="text-xl md:text-2xl font-black text-blue-900">{(occupationDiagnostics.partTimeShare * 100).toFixed(1)}%</p>
                    <p className="text-[9px] text-slate-400 mt-1">working part-time in this occupation</p>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-56 text-center z-50 shadow-lg">
                      Share of workers working part-time, among those working at least 15 hours per week.
                    </div>
                  </div>
                  {/* TN Demand for this occupation */}
                  <div className="p-4 md:p-6 bg-slate-50 rounded-[20px] md:rounded-[24px] border border-slate-100 group relative">
                    <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">TN Demand</p>
                    <DemandBadge occupation={targetOccupation} sector={sector} />
                    {(() => {
                      const trend = getOccRef(targetOccupation)?.demand_growth_category;
                      return trend ? <p className="text-[9px] text-slate-400 mt-2">Trend: {trend}</p> : null;
                    })()}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-72 text-center z-50 shadow-lg leading-relaxed normal-case font-normal tracking-normal">
                      Demand level reflects the current volume of Tennessee job postings for this occupation (sector-specific where available): High, Medium, or Low, with "Not Enough Data" where postings are too sparse. Trend classifies the occupation's share of all TN postings over recent years as Growing, Stable, or Declining.
                    </div>
                  </div>
                  {/* AI displacement risk tile — banded on 5-yr projected demand change */}
                  {(() => {
                    const s = scoreAI(occupationDiagnostics.autoExposure, occupationDiagnostics.augExposure, occupationDiagnostics.impactPct);
                    const hasData = s.band !== 'none';
                    const subLabelClass = hasData ? 'text-white/75' : 'text-slate-400';
                    const valClass = hasData ? 'text-white' : 'text-slate-700';
                    const ip = s.impactPct;
                    return (
                      <div className={`p-4 md:p-6 rounded-[20px] md:rounded-[24px] border-2 group relative shadow-sm ${s.bgSolid}`}>
                        <p className={`text-[9px] md:text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-1 ${subLabelClass}`}>
                          <Activity size={11} /> AI Outlook (5yr)
                        </p>
                        {hasData ? (
                          <>
                            <p className={`text-2xl md:text-3xl font-black ${valClass}`}>{ip! >= 0 ? '+' : ''}{ip!.toFixed(1)}%</p>
                            <p className={`text-[10px] font-black uppercase tracking-wider mt-1 ${subLabelClass}`}>{s.bandLabel}</p>
                            <p className={`text-[9px] mt-2 ${subLabelClass}`}>
                              Projected demand change
                            </p>
                          </>
                        ) : (
                          <p className="text-sm italic mt-1">No AI projection data.</p>
                        )}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-72 text-center z-50 shadow-lg leading-relaxed normal-case font-normal tracking-normal">
                          BGI's demand-adjusted 5-year projection: how employer need for this occupation is expected to shift, after accounting for AI adoption pace, demand elasticity, and physical-task constraints. Bands: High Risk ≤ −5%, Moderate Decline −5% to −2%, Stable/Growing &gt; −2%.
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ================================================================
            SECTION 04: POLICY ROADMAP — CAREER PATHWAYS
            ================================================================ */}
        <section className="space-y-6 md:space-y-10">
          <div className="flex items-center gap-3 md:gap-4 border-b-2 border-slate-200 pb-4 md:pb-6">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl md:rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs md:text-sm shadow-inner flex-shrink-0">04</div>
            <div>
              <h2 className="text-base md:text-xl font-black text-slate-800 uppercase tracking-tight leading-none">Policy Roadmap</h2>
              <p className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 md:mt-2">Career Pathways & Strategic Interventions</p>
            </div>
          </div>

          {/* 4a. Pathway Mode Selector */}
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-3 hidden sm:block">Pathway Mode</p>
            <div className="inline-flex rounded-full bg-slate-100 p-1 border border-slate-200">
              <button onClick={() => setPathwayMode('transitions')}
                className={`px-4 md:px-6 py-2 md:py-2.5 rounded-full text-[10px] md:text-xs font-black uppercase tracking-wider transition-all ${
                  pathwayMode === 'transitions' ? 'bg-blue-900 text-white shadow-lg' : 'text-slate-500 hover:text-slate-700'}`}>
                Historically Common Transitions
              </button>
              <button onClick={() => setPathwayMode('similarity')}
                className={`px-4 md:px-6 py-2 md:py-2.5 rounded-full text-[10px] md:text-xs font-black uppercase tracking-wider transition-all ${
                  pathwayMode === 'similarity' ? 'bg-blue-900 text-white shadow-lg' : 'text-slate-500 hover:text-slate-700'}`}>
                Jobs with Highly Similar Skills
              </button>
            </div>
          </div>

          {/* 4b. Destination Pathways Panel */}
          {targetOccupation && (
            <div className="bg-white p-6 md:p-10 rounded-[24px] md:rounded-[40px] shadow-sm border border-slate-200">
              <div className="flex items-center gap-3 mb-4">
                <ArrowRight size={16} className="text-amber-500 flex-shrink-0" />
                <p className="text-[10px] md:text-[11px] font-black uppercase tracking-widest text-slate-500">
                  {pathwayMode === 'transitions' && !isTransitionFallback ? 'Top Observed Transitions' : 'Most Skill-Similar Occupations'} for {pluralize(targetOccupation)}
                </p>
              </div>
              {isTransitionFallback && (
                <p className="text-xs text-amber-600 font-medium mb-4 bg-amber-50 px-4 py-2 rounded-xl border border-amber-100">
                  No observed transition data available for this occupation. Showing skill-similar occupations instead.
                </p>
              )}

              {destinationPathways.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 md:gap-4">
                  {destinationPathways.map((p, i) => {
                    const wageGain = p.wage_gain_median ?? 0;
                    const wagePct = Math.round((p.wage_gain_median_pct ?? 0) * 100);
                    const strandPct = Math.round((p.diff_strandedness ?? 0) * 100);
                    const isSelected = selectedDestination === p.name;
                    return (
                      <div key={i} onClick={() => setSelectedDestination(p.name)}
                        className={`p-4 md:p-5 rounded-2xl md:rounded-3xl border-2 cursor-pointer transition-all duration-300 ${
                          isSelected ? 'bg-blue-900 border-blue-900 shadow-xl -translate-y-1' : 'bg-white border-slate-100 hover:border-blue-300 hover:shadow-sm'}`}>
                        <p className={`text-xs md:text-sm font-black leading-snug mb-3 ${isSelected ? 'text-blue-200' : 'text-slate-800'}`}>{p.name}</p>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className={`text-[8px] md:text-[9px] font-bold uppercase tracking-widest ${isSelected ? 'text-blue-400' : 'text-slate-400'}`}>Wage Gain</span>
                            <span className={`text-[11px] md:text-xs font-black ${isSelected ? 'text-emerald-300' : 'text-emerald-600'}`}>
                              {wageGain < 0 ? `-$${Math.abs(wageGain).toLocaleString()}` : `+$${wageGain.toLocaleString()}`} ({wagePct > 0 ? `+${wagePct}` : wagePct}%)
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`text-[8px] md:text-[9px] font-bold uppercase tracking-widest ${isSelected ? 'text-blue-400' : 'text-slate-400'}`}>Strandedness</span>
                            <span className={`text-[11px] md:text-xs font-black ${strandPct < 0 ? (isSelected ? 'text-emerald-300' : 'text-emerald-600') : (isSelected ? 'text-red-300' : 'text-red-500')}`}>
                              {strandPct < 0 ? `${strandPct}% points` : `+${strandPct}% points`}
                            </span>
                          </div>
                          {pathwayMode === 'transitions' && (p.per_1000_switches || 0) > 0 && (
                            <div className="flex items-center justify-between">
                              <span className={`text-[8px] md:text-[9px] font-bold uppercase tracking-widest ${isSelected ? 'text-blue-400' : 'text-slate-400'}`}>Observed</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-3 text-center ${isSelected ? 'bg-white/10 text-blue-100' : 'bg-slate-100 text-slate-700'}`}>{p.per_1000_switches} per 1k switchers</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between group relative">
                            <span className={`text-[8px] md:text-[9px] font-bold uppercase tracking-widest ${isSelected ? 'text-blue-400' : 'text-slate-400'}`}>Similarity</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              p.similarity_rating === 'high' ? (isSelected ? 'bg-emerald-400/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700') :
                              p.similarity_rating === 'medium' ? (isSelected ? 'bg-amber-400/20 text-amber-300' : 'bg-amber-100 text-amber-700') :
                              (isSelected ? 'bg-red-400/20 text-red-300' : 'bg-red-100 text-red-700')
                            }`}>{p.similarity_rating ? p.similarity_rating.charAt(0).toUpperCase() + p.similarity_rating.slice(1) : '—'}</span>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-56 text-center z-50 shadow-lg leading-relaxed normal-case font-normal tracking-normal">
                              How closely the two occupations' skills overlap, combining the skills employers request in job postings with each occupation's skill-content profile. Rated High, Medium, or Low.
                            </div>
                          </div>
                          {/* Demand badge for destination */}
                          <div className="flex items-center justify-between group relative">
                            <span className={`text-[8px] md:text-[9px] font-bold uppercase tracking-widest ${isSelected ? 'text-blue-400' : 'text-slate-400'}`}>TN Demand</span>
                            <DemandBadge occupation={p.name} sector={sector} compact isSelected={isSelected} />
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-56 text-center z-50 shadow-lg leading-relaxed normal-case font-normal tracking-normal">
                              Demand level (High / Medium / Low) reflects the current volume of TN job postings for this occupation, sector-specific where available. The arrow shows the trend in its share of all TN postings: ↑ growing, → stable, ↓ declining.
                            </div>
                          </div>
                          {/* 5-year demand outlook for destination */}
                          {(p.ai.impact_pct_baseline !== undefined && p.ai.impact_pct_baseline !== null) && (
                            <div className="flex items-center justify-between group relative">
                              <span className={`text-[8px] md:text-[9px] font-bold uppercase tracking-widest ${isSelected ? 'text-blue-400' : 'text-slate-400'}`}>AI Outlook</span>
                              <AIBadge auto={p.ai.auto_exposure} aug={p.ai.aug_exposure} impactPct={p.ai.impact_pct_baseline} isSelected={isSelected} />
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-56 text-center z-50 shadow-lg leading-relaxed normal-case font-normal tracking-normal">
                                BGI's demand-adjusted 5-year projection of the change in employer demand for the destination occupation, accounting for AI adoption pace, demand elasticity, and physical-task constraints. Decline ≤ −5%, Soft decline −5% to −2%, Stable/Growing &gt; −2%.
                              </div>
                            </div>
                          )}
                          {/* Skill-gap (preparation) level for the move */}
                          {p.prep_label && (
                            <div className="flex items-center justify-between group relative">
                              <span className={`text-[8px] md:text-[9px] font-bold uppercase tracking-widest ${isSelected ? 'text-blue-400' : 'text-slate-400'}`}>Gap Level</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                p.prep_label === 'Little' ? (isSelected ? 'bg-emerald-400/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700') :
                                p.prep_label === 'Moderate' ? (isSelected ? 'bg-amber-400/20 text-amber-300' : 'bg-amber-100 text-amber-700') :
                                (isSelected ? 'bg-red-400/20 text-red-300' : 'bg-red-100 text-red-700')
                              }`}>{p.prep_label}</span>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-56 text-center z-50 shadow-lg leading-relaxed normal-case font-normal tracking-normal">
                              How much new skill preparation the move typically requires, based on the size of the skill gaps between the origin and destination occupations: Little, Moderate, or High.
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-sm text-slate-400 font-bold">No pathway data available for this occupation in the selected mode.</p>
                  <p className="text-xs text-slate-300 mt-2">Try switching to {pathwayMode === 'transitions' ? '"Jobs with Highly Similar Skills"' : '"Historically Common Transitions"'} mode.</p>
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              4c. Strategy Recommendations (when destination is selected)
              ================================================================ */}
          {targetOccupation && selectedDestination && selectedDestRow && (
            <div className="grid grid-cols-12 gap-10">
              <div className="col-span-12 lg:col-span-7 space-y-4 md:space-y-6">

                {/* Strategy 1: Career Advancement Pathways (Skill Gaps) */}
                <div onClick={() => setExpandedRec(expandedRec === 0 ? null : 0)}
                  className={`p-6 md:p-10 rounded-[24px] md:rounded-[40px] border-2 cursor-pointer transition-all duration-300 ${
                    expandedRec === 0 ? 'bg-white border-blue-600 shadow-xl' : 'bg-slate-50 border-transparent hover:bg-white hover:border-blue-200'}`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <BarChart3 size={18} className={expandedRec === 0 ? 'text-blue-600' : 'text-slate-300'} />
                      <h3 className={`text-sm md:text-lg font-black uppercase tracking-tight ${expandedRec === 0 ? 'text-blue-900' : 'text-slate-500'}`}>Strategy: Career Advancement Pathways</h3>
                    </div>
                    <ChevronDown className={`transition-transform duration-300 flex-shrink-0 ${expandedRec === 0 ? 'rotate-180 text-blue-600' : 'text-slate-300'}`} />
                  </div>
                  {expandedRec === 0 && (
                    <div className="mt-6 md:mt-8" onClick={e => e.stopPropagation()}>
                      <p className="text-sm text-slate-600 mb-4">
                        Based on BGI analysis of job postings data, these are the top skills that workers in <span className="font-bold">{targetOccupation}</span> roles
                        would need to develop to transition into <span className="font-bold">{selectedDestination}</span> positions.
                        Skills are ranked by the size of the gap between the two occupations.
                      </p>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Top Skill Gaps</p>
                      {selectedSkillGaps.length > 0 ? (
                        <div className="space-y-2">
                          {selectedSkillGaps.slice(0, 5).map((s, i) => (
                            <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs flex-shrink-0">{i + 1}</div>
                              <p className="text-sm font-bold text-slate-700">{s.skill}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 italic">{skills ? 'No skill gap data available for this transition.' : 'Loading skill data…'}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Strategy 2: Credentials & Licensing */}
                <div onClick={() => setExpandedRec(expandedRec === 1 ? null : 1)}
                  className={`p-6 md:p-10 rounded-[24px] md:rounded-[40px] border-2 cursor-pointer transition-all duration-300 ${
                    expandedRec === 1 ? 'bg-white border-blue-600 shadow-xl' : 'bg-slate-50 border-transparent hover:bg-white hover:border-blue-200'}`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <GraduationCap size={18} className={expandedRec === 1 ? 'text-blue-600' : 'text-slate-300'} />
                      <h3 className={`text-sm md:text-lg font-black uppercase tracking-tight ${expandedRec === 1 ? 'text-blue-900' : 'text-slate-500'}`}>Strategy: Credentials & Licensing</h3>
                    </div>
                    <ChevronDown className={`transition-transform duration-300 flex-shrink-0 ${expandedRec === 1 ? 'rotate-180 text-blue-600' : 'text-slate-300'}`} />
                  </div>
                  {expandedRec === 1 && (
                    <div className="mt-6 md:mt-8" onClick={e => e.stopPropagation()}>
                      {(() => {
                        const destLicenses = selectedDestination ? tnLicenses[selectedDestination] : undefined;
                        const destCommonCreds = selectedDestination ? commonCredentials[selectedDestination] : undefined;
                        const hasStatutory = destLicenses && destLicenses.length > 0;
                        const hasCommon = destCommonCreds && destCommonCreds.length > 0;

                        return (
                          <div className="space-y-4">
                            {/* Statutory requirements */}
                            {hasStatutory && (
                              <>
                                <p className="text-sm text-slate-600 font-medium">
                                  Tennessee requires occupational licensing for professionals in <span className="font-bold">{selectedDestination}</span> roles:
                                </p>
                                {destLicenses!.map((lic, i) => (
                                  <div key={i} className="flex items-center gap-4 p-4 bg-amber-50 rounded-2xl border border-amber-200">
                                    <GraduationCap size={18} className="text-amber-700 flex-shrink-0" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="text-sm font-black text-slate-800">{lic.profession}</h4>
                                        <span className="text-[9px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full uppercase">Required by TN Law</span>
                                        {lic.regulation && <span className="text-[10px] font-bold bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full uppercase">{lic.regulation}</span>}
                                      </div>
                                      {lic.degree && lic.degree !== 'None' && (
                                        <p className="text-xs text-slate-500 mt-1">Requires: <span className="font-bold text-slate-700">{lic.degree}</span></p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </>
                            )}

                            {/* Common industry expectations */}
                            {hasCommon && (
                              <>
                                <p className="text-sm text-slate-600 font-medium mt-2">
                                  {hasStatutory ? 'Additionally, employers' : 'While no TN state license is required, employers'} commonly expect the following credentials for <span className="font-bold">{selectedDestination}</span> roles:
                                </p>
                                {destCommonCreds!.map((cred, i) => (
                                  <div key={i} className="flex items-center gap-4 p-4 bg-blue-50 rounded-2xl border border-blue-200">
                                    <FileText size={18} className="text-blue-600 flex-shrink-0" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="text-sm font-black text-slate-800">{cred.credential}</h4>
                                        <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase">Commonly Expected</span>
                                      </div>
                                      <p className="text-xs text-slate-500 mt-1">{cred.description}</p>
                                    </div>
                                  </div>
                                ))}
                              </>
                            )}

                            {/* Credential-related skills from job postings */}
                            {credentialSkills.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Related credentials from job postings</p>
                                <div className="flex flex-wrap gap-2">
                                  {credentialSkills.map((s, i) => (
                                    <span key={i} className="text-xs font-bold text-amber-800 bg-amber-100 px-3 py-1 rounded-full">{s.skill}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Fallback if nothing found */}
                            {!hasStatutory && !hasCommon && credentialSkills.length === 0 && (
                              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <p className="text-sm text-slate-600 font-medium">No Tennessee state license or specific credential requirements were identified for {selectedDestination}.</p>
                                <p className="text-xs text-slate-400 mt-2">This occupation does not appear in the Knee Center's Tennessee occupational licensing database, and no common industry credentials were identified. We recommend checking industry certification bodies for voluntary credentials that may improve employability.</p>
                              </div>
                            )}

                            {(hasStatutory || hasCommon) && (
                              <p className="text-xs text-slate-400 mt-2">Sources: Knee Center for the Study of Occupational Regulation (TN state data, 2025); BGI job postings analysis; industry standards research.</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Strategy 3: Employer Mobility Within Occupation */}
                <div onClick={() => setExpandedRec(expandedRec === 2 ? null : 2)}
                  className={`p-6 md:p-10 rounded-[24px] md:rounded-[40px] border-2 cursor-pointer transition-all duration-300 ${
                    expandedRec === 2 ? 'bg-white border-blue-600 shadow-xl' : 'bg-slate-50 border-transparent hover:bg-white hover:border-blue-200'}`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Briefcase size={18} className={expandedRec === 2 ? 'text-blue-600' : 'text-slate-300'} />
                      <h3 className={`text-sm md:text-lg font-black uppercase tracking-tight ${expandedRec === 2 ? 'text-blue-900' : 'text-slate-500'}`}>Strategy: Employer Mobility Within Occupation</h3>
                    </div>
                    <ChevronDown className={`transition-transform duration-300 flex-shrink-0 ${expandedRec === 2 ? 'rotate-180 text-blue-600' : 'text-slate-300'}`} />
                  </div>
                  {expandedRec === 2 && (
                    <div className="mt-6 md:mt-8" onClick={e => e.stopPropagation()}>
                      {occupationDiagnostics && (() => {
                        const ptShare = occupationDiagnostics.partTimeShare || 0;
                        const ftShare = 1 - ptShare;
                        const intP = occupationDiagnostics.internalPromo5;
                        const extP = occupationDiagnostics.externalPromo5;
                        const hasIntP = intP !== undefined && intP !== null;
                        const hasExtP = extP !== undefined && extP !== null;
                        const hasPromo = hasIntP || hasExtP;
                        const totalPromo = (intP || 0) + (extP || 0);

                        const HOURS_VIABLE = ptShare >= 0.15;
                        const HOURS_PARTIAL = ptShare >= 0.07 && ptShare < 0.15;
                        const PROMO_STRONG = hasPromo && totalPromo >= 0.20;
                        const PROMO_MODERATE = hasPromo && totalPromo >= 0.10 && totalPromo < 0.20;

                        const leverDescription = (() => {
                          if (HOURS_VIABLE && (PROMO_STRONG || PROMO_MODERATE)) {
                            return <>Two within-occupation levers are credible here: <strong>scaling part-time hours up to full-time</strong> (a meaningful {(ptShare * 100).toFixed(0)}% of workers are part-time) and <strong>in-role advancement</strong> via promotion or employer switching.</>;
                          }
                          if (HOURS_VIABLE) {
                            return <>The primary within-occupation lever here is <strong>scaling part-time hours up to full-time</strong> — {(ptShare * 100).toFixed(0)}% of workers are part-time, a meaningful cohort. Promotion data is {hasPromo ? 'limited' : 'unavailable'} for this occupation, so in-role advancement is a weaker bet.</>;
                          }
                          if (PROMO_STRONG || PROMO_MODERATE) {
                            return <>Most workers in this occupation are already full-time, so hours scale-up isn't a meaningful lever. <strong>In-role advancement</strong> via promotion or employer switching is the live within-occupation path: roughly {(totalPromo * 100).toFixed(0)}% see a meaningful advance within five years.</>;
                          }
                          if (HOURS_PARTIAL) {
                            return <>Within-occupation levers are limited for this role: only {(ptShare * 100).toFixed(0)}% are part-time (modest hours scale-up potential), and promotion data is {hasPromo ? 'thin' : 'unavailable'}. A cross-occupation pathway is likely the stronger move for stranded workers here.</>;
                          }
                          return <>Within-occupation mobility is a weak lever for this role: <strong>{(ftShare * 100).toFixed(0)}% are already full-time</strong> (so hours scale-up doesn't apply), and {hasPromo ? `5-year promotion + job-move rates total only ${(totalPromo * 100).toFixed(0)}%` : 'promotion data is unavailable'}. For these workers, a cross-occupation pathway is likely the stronger move.</>;
                        })();

                        return (
                          <div className="space-y-4">
                            <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100">
                              <p className="text-sm md:text-base text-slate-700 leading-relaxed font-medium">
                                Stranded is not a universal condition of this occupation &mdash; <span className="font-black text-blue-900">{((1 - occupationDiagnostics.strandedShare) * 100).toFixed(1)}%</span> of {pluralize(targetOccupation)} are not stranded. {leverDescription}
                              </p>
                            </div>

                            {/* Tile grid: Non-stranded, FT share, Internal Promo, External Promo */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                              <div className="p-4 bg-white rounded-2xl border border-slate-100">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Non-Stranded Rate</p>
                                <p className="text-lg md:text-xl font-black text-blue-900">{((1 - occupationDiagnostics.strandedShare) * 100).toFixed(1)}%</p>
                                <p className="text-[9px] text-slate-400 mt-1">share with adequate pay &amp; utilisation</p>
                              </div>
                              <div className={`p-4 rounded-2xl border ${HOURS_VIABLE ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Full-Time Share</p>
                                <p className="text-lg md:text-xl font-black text-blue-900">{(ftShare * 100).toFixed(1)}%</p>
                                <p className="text-[9px] mt-1 text-slate-500">
                                  {HOURS_VIABLE
                                    ? <><span className="font-black text-amber-700">{(ptShare * 100).toFixed(1)}% PT</span> — hours scale-up is a real lever</>
                                    : HOURS_PARTIAL
                                      ? <>{(ptShare * 100).toFixed(1)}% PT — modest scale-up potential</>
                                      : <>{(ptShare * 100).toFixed(1)}% PT — too few to make scale-up a meaningful lever</>}
                                </p>
                              </div>
                              <div className="p-4 rounded-2xl border group relative bg-white border-slate-100">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Internal Promotion (5yr)</p>
                                <p className="text-lg md:text-xl font-black text-blue-900">{hasIntP ? `${(intP! * 100).toFixed(1)}%` : '—'}</p>
                                <p className="text-[9px] text-slate-500 mt-1">promoted by same employer within 5 yrs</p>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-56 text-center z-50 shadow-lg leading-relaxed">
                                  Share of workers in this occupation promoted to a higher-paying role at the same employer within 5 years (national).
                                </div>
                              </div>
                              <div className="p-4 rounded-2xl border group relative bg-white border-slate-100">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">External Job-Move (5yr)</p>
                                <p className="text-lg md:text-xl font-black text-blue-900">{hasExtP ? `${(extP! * 100).toFixed(1)}%` : '—'}</p>
                                <p className="text-[9px] text-slate-500 mt-1">advanced via switching employer in 5 yrs</p>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-56 text-center z-50 shadow-lg leading-relaxed">
                                  Share of workers in this occupation who advanced to a higher-paying role by switching to a different employer within 5 years.
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Strategy 4: Cross-Pathway Skill Acquisition */}
                <div onClick={() => setExpandedRec(expandedRec === 3 ? null : 3)}
                  className={`p-6 md:p-10 rounded-[24px] md:rounded-[40px] border-2 cursor-pointer transition-all duration-300 ${
                    expandedRec === 3 ? 'bg-white border-blue-600 shadow-xl' : 'bg-slate-50 border-transparent hover:bg-white hover:border-blue-200'}`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Layers size={18} className={expandedRec === 3 ? 'text-blue-600' : 'text-slate-300'} />
                      <h3 className={`text-sm md:text-lg font-black uppercase tracking-tight ${expandedRec === 3 ? 'text-blue-900' : 'text-slate-500'}`}>Strategy: Cross-Pathway Skill Acquisition</h3>
                    </div>
                    <ChevronDown className={`transition-transform duration-300 flex-shrink-0 ${expandedRec === 3 ? 'rotate-180 text-blue-600' : 'text-slate-300'}`} />
                  </div>
                  {expandedRec === 3 && (
                    <div className="mt-6 md:mt-8" onClick={e => e.stopPropagation()}>
                      <p className="text-sm text-slate-600 font-medium mb-4">
                        Skills that appear as gaps across multiple destination pathways for {pluralize(targetOccupation)}. Investing in these skills maximizes career flexibility.
                      </p>
                      {crossPathwaySkills.length > 0 ? (
                        <div className="space-y-3">
                          {crossPathwaySkills.map((s, i) => (
                            <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs flex-shrink-0">{i + 1}</div>
                                <p className="text-sm font-black text-slate-800">{s.skill}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-black text-blue-600">{s.count} of {s.totalDests}</p>
                                <p className="text-[9px] text-slate-400 uppercase tracking-widest">pathways</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 italic">{skills ? 'No cross-pathway skill data available for this occupation.' : 'Loading skill data…'}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Target Group Profile Sidebar */}
              <div className="col-span-12 lg:col-span-5">
                <div className="bg-[#1E3A8A] text-white p-6 md:p-12 rounded-[32px] md:rounded-[50px] shadow-2xl relative overflow-hidden h-full flex flex-col border-t-4 md:border-t-8 border-amber-500">
                  <div className="relative z-10">
                    <h3 className="text-xl md:text-2xl font-black leading-tight mb-6 md:mb-8 tracking-tighter uppercase text-amber-400">Target Group Profile</h3>
                    <div className="mb-6 md:mb-10 space-y-3 md:space-y-4">
                      {[
                        ['Region', geography],
                        ['Sector', sector],
                        ['Origin', targetOccupation],
                        ['Destination', selectedDestination],
                        ['Cohort', selectedCohort],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between border-b border-white/10 pb-2 md:pb-3">
                          <span className="text-blue-300 text-[9px] md:text-[10px] uppercase font-bold tracking-widest">{label}</span>
                          <span className={`font-bold text-xs md:text-sm truncate max-w-[150px] md:max-w-[200px] ${label === 'Destination' ? 'text-amber-400' : ''}`}>{value}</span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-6 md:space-y-10">
                      <div className="flex items-center gap-4 md:gap-8">
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-[20px] md:rounded-[24px] bg-white/5 flex items-center justify-center text-amber-400 shadow-inner flex-shrink-0">
                          <TrendingUp size={24} className="md:w-7 md:h-7" />
                        </div>
                        <div>
                          <p className="text-[10px] md:text-[11px] font-bold uppercase text-blue-300 tracking-widest mb-1 md:mb-2">Wage Gain</p>
                          <p className="text-2xl md:text-3xl font-black">+${(selectedDestRow.wage_gain_median ?? 0).toLocaleString()}</p>
                          <p className="text-[10px] text-blue-300 mt-1">
                            {Math.round((selectedDestRow.wage_gain_median_pct ?? 0) * 100)}% increase &bull; To ${(selectedDestRow.wage_median_destination ?? 0).toLocaleString()}/yr
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 md:gap-8">
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-[20px] md:rounded-[24px] bg-white/5 flex items-center justify-center text-amber-400 shadow-inner flex-shrink-0">
                          <Target size={24} className="md:w-7 md:h-7" />
                        </div>
                        <div>
                          <p className="text-[10px] md:text-[11px] font-bold uppercase text-blue-300 tracking-widest mb-1 md:mb-2">Strandedness Change</p>
                          <p className={`text-2xl md:text-3xl font-black ${(selectedDestRow.diff_strandedness ?? 0) < 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {Math.round((selectedDestRow.diff_strandedness ?? 0) * 100)}%<span className="text-lg"> points</span>
                          </p>
                          <p className="text-[10px] text-blue-300 mt-1">
                            Destination stranded rate: {((selectedDestRow.share_stranded_destination ?? 0) * 100).toFixed(1)}%
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 md:gap-8">
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-[20px] md:rounded-[24px] bg-white/5 flex items-center justify-center text-amber-400 shadow-inner flex-shrink-0">
                          <Layers size={24} className="md:w-7 md:h-7" />
                        </div>
                        <div className="group relative">
                          <p className="text-[10px] md:text-[11px] font-bold uppercase text-blue-300 tracking-widest mb-1 md:mb-2">Skill Similarity</p>
                          <p className="text-2xl md:text-3xl font-black capitalize">{selectedDestRow.similarity_rating || '—'}</p>
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-64 text-center z-50 shadow-lg leading-relaxed normal-case font-normal tracking-normal">
                            How closely the two occupations' skills overlap, combining the skills employers request in job postings with each occupation's skill-content profile. Rated High, Medium, or Low.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 md:gap-8">
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-[20px] md:rounded-[24px] bg-white/5 flex items-center justify-center text-amber-400 shadow-inner flex-shrink-0">
                          <Flame size={24} className="md:w-7 md:h-7" />
                        </div>
                        <div className="group relative">
                          <p className="text-[10px] md:text-[11px] font-bold uppercase text-blue-300 tracking-widest mb-1 md:mb-2">TN Demand</p>
                          <DemandBadge occupation={selectedDestination} sector={sector} />
                          {(() => {
                            const trend = selectedDestination ? getOccRef(selectedDestination)?.demand_growth_category : null;
                            return trend ? <p className="text-[10px] text-blue-300 mt-1">Trend: {trend}</p> : null;
                          })()}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-64 text-center z-50 shadow-lg leading-relaxed normal-case font-normal tracking-normal">
                            Demand level reflects the current volume of Tennessee job postings for this occupation (sector-specific where available): High, Medium, or Low, with "Not Enough Data" where postings are too sparse. Trend classifies the occupation's share of all TN postings over recent years as Growing, Stable, or Declining.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 md:gap-8">
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-[20px] md:rounded-[24px] bg-white/5 flex items-center justify-center text-amber-400 shadow-inner flex-shrink-0">
                          <Activity size={24} className="md:w-7 md:h-7" />
                        </div>
                        <div>
                          <p className="text-[10px] md:text-[11px] font-bold uppercase text-blue-300 tracking-widest mb-1 md:mb-2">AI Outlook (Destination, 5yr)</p>
                          {(() => {
                            const sDest = scoreAI(selectedDestRow.ai.auto_exposure, selectedDestRow.ai.aug_exposure, selectedDestRow.ai.impact_pct_baseline);
                            const sOrig = scoreAI(occupationDiagnostics?.autoExposure, occupationDiagnostics?.augExposure, occupationDiagnostics?.impactPct);
                            if (sDest.band === 'none') {
                              return <p className="text-sm text-blue-300 italic mt-1">No data.</p>;
                            }
                            const ip = sDest.impactPct!;
                            const delta = (sOrig.band !== 'none' && sOrig.impactPct !== null) ? ip - sOrig.impactPct : null;
                            return (
                              <>
                                <p className="text-2xl md:text-3xl font-black">
                                  {ip >= 0 ? '+' : ''}{ip.toFixed(1)}<span className="text-lg text-blue-300">%</span>
                                  <span className={`ml-2 text-[10px] font-black px-2 py-0.5 rounded-full align-middle ${sDest.bgPillDark}`}>{sDest.bandLabel}</span>
                                </p>
                                <p className="text-[10px] text-blue-300 mt-1">
                                  Projected demand change
                                  {delta !== null ? ` · vs origin ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp` : ''}
                                </p>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 md:gap-8">
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-[20px] md:rounded-[24px] bg-white/5 flex items-center justify-center text-amber-400 shadow-inner flex-shrink-0">
                          <Users size={24} className="md:w-7 md:h-7" />
                        </div>
                        <div>
                          <p className="text-[10px] md:text-[11px] font-bold uppercase text-blue-300 tracking-widest mb-1 md:mb-2">Workers in Pool</p>
                          <p className="text-2xl md:text-3xl font-black">{Math.round(cohortBreakdowns.occ.find(d => d[0] === targetOccupation)?.[1] || 0).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

      </main>

      <footer className="max-w-7xl mx-auto px-4 md:px-10 py-8 md:py-16 border-t border-slate-200 text-slate-400 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-center flex flex-col md:flex-row justify-between items-center gap-4 md:gap-0">
        <span className="text-center md:text-left">BGI Data Analytics &copy; 2026 | Tennessee Strategic Workforce Dashboard</span>
        <div className="flex gap-6 md:gap-10">
          <a href="#" className="hover:text-blue-600">Methodology</a>
          <a href="#" className="hover:text-blue-600">Source Data</a>
        </div>
      </footer>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);
