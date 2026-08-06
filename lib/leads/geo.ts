/**
 * Approximate lead location from Vercel request geo headers.
 *
 * Headers (Node / Vercel only — absent on localhost):
 *   x-vercel-ip-city            URL-encoded city
 *   x-vercel-ip-country-region  region/state code
 *   x-vercel-ip-country         ISO-3166 alpha-2
 *
 * Local smoke: set LEAD_GEO_OVERRIDE=City|Region|Country (e.g. Boston|MA|US).
 * Ignored when Vercel geo headers are present.
 */
export type LeadGeo = {
  geoCity: string | null;
  geoRegion: string | null;
  geoCountry: string | null;
  /** Pre-formatted "City · Region · US", or null when nothing present. */
  approxLocation: string | null;
};

const US_REGION_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

export const LOCATION_UNAVAILABLE = 'Location unavailable';

function headerValue(
  headers: Headers | { get(name: string): string | null },
  name: string,
): string | null {
  const raw = headers.get(name)?.trim();
  return raw || null;
}

/** Decode a Vercel city header; tolerate already-decoded or malformed input. */
export function decodeVercelCity(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return decodeURIComponent(raw.trim().replace(/\+/g, ' '));
  } catch {
    return raw.trim();
  }
}

export function formatApproxLocation(parts: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): string | null {
  const city = parts.city?.trim() || null;
  let region = parts.region?.trim() || null;
  const country = parts.country?.trim().toUpperCase() || null;

  if (region && country === 'US') {
    region = US_REGION_NAMES[region.toUpperCase()] ?? region;
  }

  const joined = [city, region, country].filter(Boolean).join(' · ');
  return joined || null;
}

function emptyGeo(): LeadGeo {
  return {
    geoCity: null,
    geoRegion: null,
    geoCountry: null,
    approxLocation: null,
  };
}

function geoFromParts(parts: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): LeadGeo {
  const geoCity = parts.city?.trim() || null;
  const geoRegion = parts.region?.trim() || null;
  const geoCountry = parts.country?.trim().toUpperCase() || null;
  return {
    geoCity,
    geoRegion,
    geoCountry,
    approxLocation: formatApproxLocation({
      city: geoCity,
      region: geoRegion,
      country: geoCountry,
    }),
  };
}

/** Parse LEAD_GEO_OVERRIDE=City|Region|Country for local smoke tests. */
export function leadGeoFromOverride(
  raw: string | null | undefined = process.env.LEAD_GEO_OVERRIDE,
): LeadGeo | null {
  const value = raw?.trim();
  if (!value) return null;
  const [city, region, country] = value.split('|').map((p) => p?.trim() || null);
  const geo = geoFromParts({ city, region, country });
  return geo.approxLocation ? geo : null;
}

/**
 * Read geo from an incoming Request (or Headers). Safe when headers are absent
 * (local dev) — returns all-null LeadGeo unless LEAD_GEO_OVERRIDE is set.
 */
export function leadGeoFromHeaders(
  headers: Headers | { get(name: string): string | null },
): LeadGeo {
  // Vercel (primary). Also accept Cloudflare-style names if a proxy sits in front.
  const geoCity =
    decodeVercelCity(headerValue(headers, 'x-vercel-ip-city')) ??
    decodeVercelCity(headerValue(headers, 'cf-ipcity'));
  const geoRegion =
    headerValue(headers, 'x-vercel-ip-country-region') ??
    headerValue(headers, 'cf-region-code') ??
    headerValue(headers, 'cf-region');
  const geoCountry =
    (
      headerValue(headers, 'x-vercel-ip-country') ??
      headerValue(headers, 'cf-ipcountry')
    )?.toUpperCase() ?? null;

  const fromHeaders = geoFromParts({
    city: geoCity,
    region: geoRegion,
    country: geoCountry,
  });
  if (fromHeaders.approxLocation) return fromHeaders;

  const override = leadGeoFromOverride();
  if (override) return override;

  return emptyGeo();
}

/** Display string for email / CRM (never empty). */
export function approxLocationDisplay(value: string | null | undefined): string {
  return value?.trim() || LOCATION_UNAVAILABLE;
}
