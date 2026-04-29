// ── Property Validation Types ─────────────────────────────────────────

export type PropertyOwnershipStatus =
  | 'owner_occupied'    // Verified homeowner living at the property
  | 'absentee_owner'    // Owns property but lives elsewhere
  | 'renter'           // Not the owner
  | 'unknown';          // Could not determine

export interface PropertyValidationResult {
  validatedAt: string;
  status: 'success' | 'not_found' | 'error';
  ownershipStatus: PropertyOwnershipStatus;
  isVerifiedHomeowner: boolean;
  claimedHomeowner: boolean;         // What the lead claimed on the web form
  homeownerMismatch: boolean;        // true when claimed owner but records say otherwise

  // Property details from government records
  ownerName?: string;
  propertyType?: string;             // 'single_family', 'condo', 'multi_family', etc.
  yearBuilt?: number;
  assessedValue?: number;
  estimatedValue?: number;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  lotSize?: number;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };

  // Bundle opportunity scoring
  bundleScore?: number;              // 0-100: higher = better home+auto bundle candidate
  bundleOpportunity?: boolean;       // Shorthand: qualifies for bundle pitch

  // Raw API details
  apiSource?: string;
  errorMessage?: string;
  rawResponse?: unknown;
}

export interface PropertyValidationRequest {
  firstName: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  claimedHomeowner?: boolean;
}
