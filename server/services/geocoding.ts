const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const MIN_REQUEST_INTERVAL_MS = 1100;

interface NominatimResponse {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    suburb?: string;
    neighbourhood?: string;
    county?: string;
    state?: string;
    country?: string;
  };
  display_name?: string;
}

const cache = new Map<string, { description: string; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

let lastRequestTime = 0;

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url, options);
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached.description;
  }

  try {
    const response = await rateLimitedFetch(
      `${NOMINATIM_URL}?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'DeecellFleetDashboard/1.0 (admin@deecell.com)',
        },
      }
    );

    if (!response.ok) return null;

    const data: NominatimResponse = await response.json();
    if (!data.address) return null;

    const addr = data.address;
    const city = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || addr.neighbourhood || addr.county;
    const state = addr.state;

    let description: string | null = null;
    if (city && state) {
      const stateAbbr = US_STATE_ABBRS[state] || state;
      description = `${city}, ${stateAbbr}`;
    } else if (city) {
      description = city;
    } else if (state) {
      description = state;
    }

    if (description) {
      if (cache.size >= MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
      }
      cache.set(key, { description, timestamp: Date.now() });
    }

    return description;
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    return null;
  }
}

export function hasCoordinatesChanged(
  oldLat: number | null, oldLng: number | null,
  newLat: number, newLng: number,
  thresholdKm: number = 1
): boolean {
  if (oldLat === null || oldLng === null) return true;
  const R = 6371;
  const dLat = (newLat - oldLat) * Math.PI / 180;
  const dLng = (newLng - oldLng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(oldLat * Math.PI / 180) * Math.cos(newLat * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c >= thresholdKm;
}

const US_STATE_ABBRS: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};
