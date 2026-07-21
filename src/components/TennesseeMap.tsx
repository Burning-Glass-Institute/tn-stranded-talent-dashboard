import React, { useMemo, useState } from 'react';
import { geoPath, geoAlbersUsa } from 'd3-geo';
// County GeoJSON (2.2 MB) is fetched at runtime (see src/data/initData) and passed
// in as a prop so it never enters the JS bundle. The small MSA/division crosswalks
// stay bundled.
import countyMapping from '../data/reference/county-msa-mapping.json';
import countyDivisionMapping from '../data/reference/county-division-mapping.json';

type MSACategory = 'Nashville' | 'Memphis' | 'Knoxville' | 'Chattanooga' | 'Other MSA';
type GrandDivision = 'East' | 'Middle' | 'West';
type GeoOption = MSACategory | GrandDivision;

const GRAND_DIVISIONS: GrandDivision[] = ['East', 'Middle', 'West'];

/** Display label for the combined non-major-metro bucket. Data key stays 'Other MSA' (matches
 *  the pipeline + view store); rural counties are folded in here, so an "MSA" label would
 *  misleadingly imply rural is excluded. */
const geoLabel = (g: string) => (g === 'Other MSA' ? 'Other & Rural TN' : g);

interface TennesseeMapProps {
  selectedRegion: GeoOption | 'All';
  onRegionClick: (region: GeoOption) => void;
  countyBoundaries: any;
}

interface CountyFeature {
  type: string;
  properties: {
    NAME: string;
    [key: string]: any;
  };
  geometry: any;
}

interface RegionGroups {
  [key: string]: CountyFeature[];
}

const TennesseeMap: React.FC<TennesseeMapProps> = ({ selectedRegion, onRegionClick, countyBoundaries }) => {
  const [hoveredRegion, setHoveredRegion] = useState<GeoOption | null>(null);

  // Memoize path generator
  const pathGenerator = useMemo(() => {
    const projection = geoAlbersUsa()
      .fitSize([1000, 400], countyBoundaries as any);
    return geoPath().projection(projection);
  }, [countyBoundaries]);

  // Group counties by MSA region
  const regionGroups = useMemo(() => {
    const groups: RegionGroups = {
      'Nashville': [],
      'Memphis': [],
      'Knoxville': [],
      'Chattanooga': [],
      'Other MSA': [],
    };

    (countyBoundaries as any).features.forEach((feature: CountyFeature) => {
      const countyName = feature.properties.NAME;
      let msaCategory = (countyMapping as any)[countyName] || 'Other MSA';
      // Merge any legacy 'Rural' into 'Other MSA'
      if (msaCategory === 'Rural') msaCategory = 'Other MSA';
      groups[msaCategory].push(feature);
    });

    return groups;
  }, [countyBoundaries]);

  // Get region fill color with more diverse palette
  const getRegionColor = (region: MSACategory, isSelected: boolean, isHovered: boolean): string => {
    // If "All Tennessee" is selected, show all regions in a unified color
    if (selectedRegion === 'All') {
      return '#1E3A8A'; // Navy blue for all regions when "All" is selected
    }

    if (isSelected) return '#1E3A8A'; // Navy blue for selected
    if (isHovered) return '#93C5FD'; // Light blue for hover

    // More diverse color palette for better distinction
    const baseColors: Record<MSACategory, string> = {
      'Nashville': '#F59E0B',    // Amber
      'Memphis': '#8B5CF6',      // Purple
      'Knoxville': '#10B981',    // Emerald
      'Chattanooga': '#EF4444',  // Red
      'Other MSA': '#06B6D4',    // Cyan
    };

    return baseColors[region];
  };

  // Region order for legend
  const regionOrder: MSACategory[] = ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Other MSA'];

  // When a Grand Division is selected or hovered, county fill is decided per
  // county via the tn.gov county-to-division crosswalk rather than per MSA group.
  const selectedDivision = GRAND_DIVISIONS.includes(selectedRegion as GrandDivision) ? (selectedRegion as GrandDivision) : null;
  const hoveredDivision = hoveredRegion && GRAND_DIVISIONS.includes(hoveredRegion as GrandDivision) ? (hoveredRegion as GrandDivision) : null;

  const getCountyFill = (county: CountyFeature, msaRegion: MSACategory, isSelected: boolean, isHovered: boolean): string => {
    const division = (countyDivisionMapping as Record<string, GrandDivision>)[county.properties.NAME];
    if (hoveredDivision) {
      if (division === hoveredDivision) return '#93C5FD';
      return selectedDivision && division === selectedDivision ? '#1E3A8A' : '#E2E8F0';
    }
    if (selectedDivision) {
      return division === selectedDivision ? '#1E3A8A' : '#E2E8F0';
    }
    return getRegionColor(msaRegion, isSelected, isHovered);
  };

  return (
    <div className="space-y-6">
      {/* Selected Geography Indicator */}
      <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl px-6 py-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Selected Geography
          </span>
          <span className="text-lg font-black text-slate-900">
            {selectedRegion === 'All' ? 'All Tennessee' : geoLabel(selectedRegion)}
          </span>
        </div>
      </div>

      {/* Map and Legend Container */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* Legend - Left Side */}
        <div className="flex flex-row md:flex-col gap-2 flex-wrap md:min-w-[140px]">
          {/* All Tennessee Option */}
          <button
            onClick={() => onRegionClick('All' as MSACategory)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              selectedRegion === 'All'
                ? 'bg-blue-50 border-2 border-blue-900'
                : 'bg-white border-2 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div
              className="w-6 h-6 rounded-md border-2 border-slate-300 shadow-sm flex-shrink-0 bg-gradient-to-br from-slate-100 to-slate-200"
            />
            <span className={`text-xs font-bold ${
              selectedRegion === 'All' ? 'text-blue-900' : 'text-slate-700'
            }`}>
              All Tennessee
            </span>
          </button>

          {regionOrder.map((region) => {
            const isSelected = selectedRegion === region;
            const isHovered = hoveredRegion === region;
            const color = getRegionColor(region, isSelected, isHovered);

            return (
              <button
                key={region}
                onClick={() => onRegionClick(region)}
                onMouseEnter={() => setHoveredRegion(region)}
                onMouseLeave={() => setHoveredRegion(null)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isSelected
                    ? 'bg-blue-50 border-2 border-blue-900'
                    : isHovered
                    ? 'bg-slate-50 border-2 border-blue-300'
                    : 'bg-white border-2 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div
                  className="w-6 h-6 rounded-md border-2 border-white shadow-sm flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className={`text-xs font-bold ${
                  isSelected ? 'text-blue-900' : 'text-slate-700'
                }`}>
                  {geoLabel(region)}
                </span>
              </button>
            );
          })}

          {/* Grand Divisions (East / Middle / West) */}
          <div className="w-full mt-1 pt-2 border-t-2 border-slate-100">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Grand Divisions</p>
          </div>
          {GRAND_DIVISIONS.map((division) => {
            const isSelected = selectedRegion === division;
            const isHovered = hoveredRegion === division;
            return (
              <button
                key={division}
                onClick={() => onRegionClick(division)}
                onMouseEnter={() => setHoveredRegion(division)}
                onMouseLeave={() => setHoveredRegion(null)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isSelected
                    ? 'bg-blue-50 border-2 border-blue-900'
                    : isHovered
                    ? 'bg-slate-50 border-2 border-blue-300'
                    : 'bg-white border-2 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div
                  className="w-6 h-6 rounded-md border-2 border-white shadow-sm flex-shrink-0"
                  style={{ backgroundColor: isSelected ? '#1E3A8A' : isHovered ? '#93C5FD' : '#CBD5E1' }}
                />
                <span className={`text-xs font-bold ${
                  isSelected ? 'text-blue-900' : 'text-slate-700'
                }`}>
                  {division}
                </span>
              </button>
            );
          })}
        </div>

        {/* Map */}
        <div className="flex-1 relative aspect-[2.4/1]">
          <svg viewBox="0 0 1000 400" className="w-full h-full drop-shadow-lg">
            {/* Render counties grouped by MSA region */}
            {Object.entries(regionGroups).map(([region, counties]) => {
              const msaRegion = region as MSACategory;
              const isSelected = selectedRegion === msaRegion;
              const isHovered = hoveredRegion === msaRegion;
              const countyList = counties as CountyFeature[];

              return (
                <g
                  key={region}
                  onClick={() => onRegionClick(msaRegion)}
                  onMouseEnter={() => setHoveredRegion(msaRegion)}
                  onMouseLeave={() => setHoveredRegion(null)}
                  className="cursor-pointer"
                >
                  {countyList.map((county, idx) => (
                    <path
                      key={`${region}-${idx}`}
                      d={pathGenerator(county as any) || ''}
                      fill={getCountyFill(county, msaRegion, isSelected, isHovered)}
                      className="transition-all duration-200 stroke-white"
                      strokeWidth={isSelected ? 1.5 : 0.5}
                    />
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
};

export default TennesseeMap;
