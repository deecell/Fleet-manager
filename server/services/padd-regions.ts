/**
 * PADD (Petroleum Administration for Defense Districts) Region Mapping
 * 
 * The EIA provides diesel prices by PADD region:
 * - PADD 1: East Coast (subdivided into 1A, 1B, 1C)
 * - PADD 2: Midwest
 * - PADD 3: Gulf Coast
 * - PADD 4: Rocky Mountain
 * - PADD 5: West Coast
 */

export type PADDRegion = "PADD1" | "PADD1A" | "PADD1B" | "PADD1C" | "PADD2" | "PADD3" | "PADD4" | "PADD5" | "US";

interface PADDInfo {
  code: PADDRegion;
  name: string;
  eiaCode: string;
}

const STATE_TO_PADD: Record<string, PADDInfo> = {
  // PADD 1A - New England
  CT: { code: "PADD1A", name: "New England", eiaCode: "R1X" },
  MA: { code: "PADD1A", name: "New England", eiaCode: "R1X" },
  ME: { code: "PADD1A", name: "New England", eiaCode: "R1X" },
  NH: { code: "PADD1A", name: "New England", eiaCode: "R1X" },
  RI: { code: "PADD1A", name: "New England", eiaCode: "R1X" },
  VT: { code: "PADD1A", name: "New England", eiaCode: "R1X" },

  // PADD 1B - Central Atlantic
  DC: { code: "PADD1B", name: "Central Atlantic", eiaCode: "R1Y" },
  DE: { code: "PADD1B", name: "Central Atlantic", eiaCode: "R1Y" },
  MD: { code: "PADD1B", name: "Central Atlantic", eiaCode: "R1Y" },
  NJ: { code: "PADD1B", name: "Central Atlantic", eiaCode: "R1Y" },
  NY: { code: "PADD1B", name: "Central Atlantic", eiaCode: "R1Y" },
  PA: { code: "PADD1B", name: "Central Atlantic", eiaCode: "R1Y" },

  // PADD 1C - Lower Atlantic
  FL: { code: "PADD1C", name: "Lower Atlantic", eiaCode: "R1Z" },
  GA: { code: "PADD1C", name: "Lower Atlantic", eiaCode: "R1Z" },
  NC: { code: "PADD1C", name: "Lower Atlantic", eiaCode: "R1Z" },
  SC: { code: "PADD1C", name: "Lower Atlantic", eiaCode: "R1Z" },
  VA: { code: "PADD1C", name: "Lower Atlantic", eiaCode: "R1Z" },
  WV: { code: "PADD1C", name: "Lower Atlantic", eiaCode: "R1Z" },

  // PADD 2 - Midwest
  IA: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  IL: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  IN: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  KS: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  KY: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  MI: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  MN: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  MO: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  ND: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  NE: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  OH: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  OK: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  SD: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  TN: { code: "PADD2", name: "Midwest", eiaCode: "R20" },
  WI: { code: "PADD2", name: "Midwest", eiaCode: "R20" },

  // PADD 3 - Gulf Coast
  AL: { code: "PADD3", name: "Gulf Coast", eiaCode: "R30" },
  AR: { code: "PADD3", name: "Gulf Coast", eiaCode: "R30" },
  LA: { code: "PADD3", name: "Gulf Coast", eiaCode: "R30" },
  MS: { code: "PADD3", name: "Gulf Coast", eiaCode: "R30" },
  NM: { code: "PADD3", name: "Gulf Coast", eiaCode: "R30" },
  TX: { code: "PADD3", name: "Gulf Coast", eiaCode: "R30" },

  // PADD 4 - Rocky Mountain
  CO: { code: "PADD4", name: "Rocky Mountain", eiaCode: "R40" },
  ID: { code: "PADD4", name: "Rocky Mountain", eiaCode: "R40" },
  MT: { code: "PADD4", name: "Rocky Mountain", eiaCode: "R40" },
  UT: { code: "PADD4", name: "Rocky Mountain", eiaCode: "R40" },
  WY: { code: "PADD4", name: "Rocky Mountain", eiaCode: "R40" },

  // PADD 5 - West Coast
  AK: { code: "PADD5", name: "West Coast", eiaCode: "R50" },
  AZ: { code: "PADD5", name: "West Coast", eiaCode: "R50" },
  CA: { code: "PADD5", name: "West Coast", eiaCode: "R50" },
  HI: { code: "PADD5", name: "West Coast", eiaCode: "R50" },
  NV: { code: "PADD5", name: "West Coast", eiaCode: "R50" },
  OR: { code: "PADD5", name: "West Coast", eiaCode: "R50" },
  WA: { code: "PADD5", name: "West Coast", eiaCode: "R50" },
};

const US_INFO: PADDInfo = { code: "US", name: "U.S. National Average", eiaCode: "R00" };

export function getPADDFromState(stateCode: string): PADDInfo {
  const normalized = stateCode.toUpperCase().trim();
  return STATE_TO_PADD[normalized] || US_INFO;
}

export function getEIACodeForPADD(paddCode: PADDRegion): string {
  switch (paddCode) {
    case "PADD1A": return "R1X";
    case "PADD1B": return "R1Y";
    case "PADD1C": return "R1Z";
    case "PADD2": return "R20";
    case "PADD3": return "R30";
    case "PADD4": return "R40";
    case "PADD5": return "R50";
    case "US":
    default: return "R00";
  }
}

export function getPADDRegionName(paddCode: PADDRegion): string {
  switch (paddCode) {
    case "PADD1A": return "New England";
    case "PADD1B": return "Central Atlantic";
    case "PADD1C": return "Lower Atlantic";
    case "PADD1": return "East Coast";
    case "PADD2": return "Midwest";
    case "PADD3": return "Gulf Coast";
    case "PADD4": return "Rocky Mountain";
    case "PADD5": return "West Coast";
    case "US":
    default: return "U.S. National Average";
  }
}

export function getStateFromCoordinates(lat: number, lng: number): string | null {
  const statePolygons = getSimplifiedStateBounds();
  
  for (const [state, bounds] of Object.entries(statePolygons)) {
    if (lat >= bounds.minLat && lat <= bounds.maxLat &&
        lng >= bounds.minLng && lng <= bounds.maxLng) {
      return state;
    }
  }
  
  return null;
}

export function getPADDFromCoordinates(lat: number, lng: number): PADDInfo {
  const state = getStateFromCoordinates(lat, lng);
  if (state) {
    return getPADDFromState(state);
  }
  return US_INFO;
}

function getSimplifiedStateBounds(): Record<string, { minLat: number; maxLat: number; minLng: number; maxLng: number }> {
  return {
    AL: { minLat: 30.2, maxLat: 35.0, minLng: -88.5, maxLng: -84.9 },
    AK: { minLat: 51.2, maxLat: 71.4, minLng: -179.2, maxLng: -129.9 },
    AZ: { minLat: 31.3, maxLat: 37.0, minLng: -114.8, maxLng: -109.0 },
    AR: { minLat: 33.0, maxLat: 36.5, minLng: -94.6, maxLng: -89.6 },
    CA: { minLat: 32.5, maxLat: 42.0, minLng: -124.4, maxLng: -114.1 },
    CO: { minLat: 37.0, maxLat: 41.0, minLng: -109.1, maxLng: -102.0 },
    CT: { minLat: 41.0, maxLat: 42.1, minLng: -73.7, maxLng: -71.8 },
    DE: { minLat: 38.5, maxLat: 39.8, minLng: -75.8, maxLng: -75.0 },
    FL: { minLat: 24.5, maxLat: 31.0, minLng: -87.6, maxLng: -80.0 },
    GA: { minLat: 30.4, maxLat: 35.0, minLng: -85.6, maxLng: -80.8 },
    HI: { minLat: 18.9, maxLat: 22.2, minLng: -160.2, maxLng: -154.8 },
    ID: { minLat: 42.0, maxLat: 49.0, minLng: -117.2, maxLng: -111.0 },
    IL: { minLat: 36.9, maxLat: 42.5, minLng: -91.5, maxLng: -87.0 },
    IN: { minLat: 37.8, maxLat: 41.8, minLng: -88.1, maxLng: -84.8 },
    IA: { minLat: 40.4, maxLat: 43.5, minLng: -96.6, maxLng: -90.1 },
    KS: { minLat: 37.0, maxLat: 40.0, minLng: -102.1, maxLng: -94.6 },
    KY: { minLat: 36.5, maxLat: 39.1, minLng: -89.6, maxLng: -82.0 },
    LA: { minLat: 28.9, maxLat: 33.0, minLng: -94.0, maxLng: -88.8 },
    ME: { minLat: 43.0, maxLat: 47.5, minLng: -71.1, maxLng: -66.9 },
    MD: { minLat: 37.9, maxLat: 39.7, minLng: -79.5, maxLng: -75.0 },
    MA: { minLat: 41.2, maxLat: 42.9, minLng: -73.5, maxLng: -69.9 },
    MI: { minLat: 41.7, maxLat: 48.2, minLng: -90.4, maxLng: -82.1 },
    MN: { minLat: 43.5, maxLat: 49.4, minLng: -97.2, maxLng: -89.5 },
    MS: { minLat: 30.2, maxLat: 35.0, minLng: -91.7, maxLng: -88.1 },
    MO: { minLat: 36.0, maxLat: 40.6, minLng: -95.8, maxLng: -89.1 },
    MT: { minLat: 44.4, maxLat: 49.0, minLng: -116.1, maxLng: -104.0 },
    NE: { minLat: 40.0, maxLat: 43.0, minLng: -104.1, maxLng: -95.3 },
    NV: { minLat: 35.0, maxLat: 42.0, minLng: -120.0, maxLng: -114.0 },
    NH: { minLat: 42.7, maxLat: 45.3, minLng: -72.6, maxLng: -70.7 },
    NJ: { minLat: 38.9, maxLat: 41.4, minLng: -75.6, maxLng: -73.9 },
    NM: { minLat: 31.3, maxLat: 37.0, minLng: -109.1, maxLng: -103.0 },
    NY: { minLat: 40.5, maxLat: 45.0, minLng: -79.8, maxLng: -71.9 },
    NC: { minLat: 33.8, maxLat: 36.6, minLng: -84.3, maxLng: -75.5 },
    ND: { minLat: 45.9, maxLat: 49.0, minLng: -104.1, maxLng: -96.6 },
    OH: { minLat: 38.4, maxLat: 42.0, minLng: -84.8, maxLng: -80.5 },
    OK: { minLat: 33.6, maxLat: 37.0, minLng: -103.0, maxLng: -94.4 },
    OR: { minLat: 42.0, maxLat: 46.3, minLng: -124.6, maxLng: -116.5 },
    PA: { minLat: 39.7, maxLat: 42.3, minLng: -80.5, maxLng: -74.7 },
    RI: { minLat: 41.1, maxLat: 42.0, minLng: -71.9, maxLng: -71.1 },
    SC: { minLat: 32.0, maxLat: 35.2, minLng: -83.4, maxLng: -78.5 },
    SD: { minLat: 42.5, maxLat: 45.9, minLng: -104.1, maxLng: -96.4 },
    TN: { minLat: 35.0, maxLat: 36.7, minLng: -90.3, maxLng: -81.6 },
    TX: { minLat: 25.8, maxLat: 36.5, minLng: -106.7, maxLng: -93.5 },
    UT: { minLat: 37.0, maxLat: 42.0, minLng: -114.1, maxLng: -109.0 },
    VT: { minLat: 42.7, maxLat: 45.0, minLng: -73.4, maxLng: -71.5 },
    VA: { minLat: 36.5, maxLat: 39.5, minLng: -83.7, maxLng: -75.2 },
    WA: { minLat: 45.5, maxLat: 49.0, minLng: -124.8, maxLng: -116.9 },
    WV: { minLat: 37.2, maxLat: 40.6, minLng: -82.6, maxLng: -77.7 },
    WI: { minLat: 42.5, maxLat: 47.1, minLng: -92.9, maxLng: -86.2 },
    WY: { minLat: 41.0, maxLat: 45.0, minLng: -111.1, maxLng: -104.1 },
    DC: { minLat: 38.8, maxLat: 39.0, minLng: -77.1, maxLng: -77.0 },
  };
}

export function getAllPADDCodes(): PADDRegion[] {
  return ["PADD1A", "PADD1B", "PADD1C", "PADD2", "PADD3", "PADD4", "PADD5"];
}
