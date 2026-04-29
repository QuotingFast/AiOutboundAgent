import { logger } from '../utils/logger';
import { PropertyValidationRequest, PropertyValidationResult, PropertyOwnershipStatus } from './types';

// ── Property Validation Client ───────────────────────────────────────
// Uses the Fetch.com property API (fc- API key) for homeownership
// verification against nationwide government property records.

const FETCH_API_KEY = process.env.PROPERTY_API_KEY || 'fc-c8c042023698465f8a6e1bdc8a92783f';
const FETCH_API_BASE = 'https://api.fetch.com/v2';
const REQUEST_TIMEOUT_MS = 8000;

// Name similarity check for owner matching (simple)
function nameSimilar(recordName: string, firstName: string, lastName?: string): boolean {
  const rec = recordName.toLowerCase();
  const first = firstName.toLowerCase();
  const last = (lastName || '').toLowerCase();
  return rec.includes(first) || (last.length > 0 && rec.includes(last));
}

function buildBundleScore(result: Partial<PropertyValidationResult>): number {
  let score = 0;

  if (result.isVerifiedHomeowner) score += 40;
  if (result.ownershipStatus === 'owner_occupied') score += 20;

  const val = result.estimatedValue || result.assessedValue || 0;
  if (val > 400_000) score += 20;
  else if (val > 200_000) score += 15;
  else if (val > 100_000) score += 10;

  if (result.propertyType === 'single_family') score += 10;
  else if (result.propertyType === 'condo') score += 5;

  if (result.yearBuilt && result.yearBuilt >= 2000) score += 10;
  else if (result.yearBuilt && result.yearBuilt >= 1980) score += 5;

  return Math.min(100, score);
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function validatePropertyOwnership(
  req: PropertyValidationRequest
): Promise<PropertyValidationResult> {
  const now = new Date().toISOString();
  const claimedHomeowner = req.claimedHomeowner ?? false;

  if (!req.address && !req.zip) {
    return {
      validatedAt: now,
      status: 'not_found',
      ownershipStatus: 'unknown',
      isVerifiedHomeowner: false,
      claimedHomeowner,
      homeownerMismatch: false,
      errorMessage: 'Insufficient address data for property lookup',
    };
  }

  try {
    const payload = {
      first_name: req.firstName,
      last_name: req.lastName || '',
      address: req.address || '',
      city: req.city || '',
      state: req.state || '',
      zip: req.zip || '',
      phone: req.phone || '',
    };

    const response = await fetchWithTimeout(
      `${FETCH_API_BASE}/property/ownership`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FETCH_API_KEY}`,
          'X-API-Version': '2',
        },
        body: JSON.stringify(payload),
      },
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`API ${response.status}: ${errText}`);
    }

    const data = await response.json() as Record<string, any>;

    const ownerName: string = data.owner_name || data.owner?.name || '';
    const rawOwnershipType: string = (data.ownership_type || data.owner_occupancy_status || '').toLowerCase();

    let ownershipStatus: PropertyOwnershipStatus = 'unknown';
    if (rawOwnershipType.includes('owner') && rawOwnershipType.includes('occupied')) {
      ownershipStatus = 'owner_occupied';
    } else if (rawOwnershipType.includes('owner') || rawOwnershipType.includes('absentee')) {
      ownershipStatus = 'absentee_owner';
    } else if (rawOwnershipType.includes('rent') || rawOwnershipType.includes('tenant')) {
      ownershipStatus = 'renter';
    } else if (data.is_owner === true) {
      ownershipStatus = 'owner_occupied';
    } else if (data.is_owner === false) {
      ownershipStatus = 'renter';
    }

    // Cross-reference owner name with lead name for final determination
    const nameMatchesOwner = ownerName
      ? nameSimilar(ownerName, req.firstName, req.lastName)
      : false;

    const isVerifiedHomeowner =
      (ownershipStatus === 'owner_occupied' || ownershipStatus === 'absentee_owner') &&
      (nameMatchesOwner || !ownerName);

    const homeownerMismatch = claimedHomeowner && !isVerifiedHomeowner;

    const partial: Partial<PropertyValidationResult> = {
      ownerName: ownerName || undefined,
      ownershipStatus,
      isVerifiedHomeowner,
      propertyType: data.property_type || data.land_use || undefined,
      yearBuilt: data.year_built ? Number(data.year_built) : undefined,
      assessedValue: data.assessed_value ? Number(data.assessed_value) : undefined,
      estimatedValue: data.estimated_value || data.avm_value ? Number(data.estimated_value || data.avm_value) : undefined,
      squareFootage: data.building_sqft || data.square_footage ? Number(data.building_sqft || data.square_footage) : undefined,
      bedrooms: data.bedrooms ? Number(data.bedrooms) : undefined,
      bathrooms: data.bathrooms ? Number(data.bathrooms) : undefined,
      lotSize: data.lot_sqft ? Number(data.lot_sqft) : undefined,
    };

    if (data.address || req.address) {
      partial.address = {
        street: data.address?.street || req.address || '',
        city: data.address?.city || req.city || '',
        state: data.address?.state || req.state || '',
        zip: data.address?.zip || req.zip || '',
      };
    }

    const bundleScore = buildBundleScore(partial);

    const result: PropertyValidationResult = {
      ...partial,
      validatedAt: now,
      status: 'success',
      claimedHomeowner,
      homeownerMismatch,
      bundleScore,
      bundleOpportunity: bundleScore >= 50,
      apiSource: 'fetch.com',
      rawResponse: data,
    } as PropertyValidationResult;

    logger.info('property', 'Property validated', {
      name: `${req.firstName} ${req.lastName}`,
      ownershipStatus,
      isVerifiedHomeowner,
      homeownerMismatch,
      bundleScore,
    });

    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('property', 'Property validation failed', { error: msg });

    return {
      validatedAt: now,
      status: 'error',
      ownershipStatus: 'unknown',
      isVerifiedHomeowner: false,
      claimedHomeowner,
      homeownerMismatch: false,
      errorMessage: msg,
      apiSource: 'fetch.com',
    };
  }
}

// ── Homeowner claim extraction ─────────────────────────────────────
// Detects whether a weblead payload claims homeowner status from
// various common field names used by lead vendors.

export function extractClaimedHomeowner(body: Record<string, any>): boolean {
  const ho =
    body.homeowner ??
    body.home_owner ??
    body.is_homeowner ??
    body.isHomeowner ??
    body.data?.homeowner ??
    body.data?.home_owner ??
    body.data?.is_homeowner ??
    body.contact?.homeowner ??
    null;

  if (ho === null || ho === undefined) {
    // Fall back to product_type / coverage_type hinting "home"
    const productType = (
      body.product_type || body.productType ||
      body.data?.product_type || body.data?.coverage_type ||
      body.requested_coverage || ''
    ).toString().toLowerCase();

    return productType.includes('home') || productType.includes('homeowner');
  }

  if (typeof ho === 'boolean') return ho;
  if (typeof ho === 'string') return ['yes', 'true', '1', 'y'].includes(ho.toLowerCase());
  return Boolean(ho);
}
