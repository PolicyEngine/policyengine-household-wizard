/**
 * US states and territories supported by PolicyEngine US.
 *
 * Codes match the `state_code` enum in the PolicyEngine US country model so the
 * draft's `state` field can be passed through to API payloads unchanged.
 */
export interface USState {
  code: string;
  name: string;
}

export const US_STATES: ReadonlyArray<USState> = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

const STATE_CODES = new Set(US_STATES.map((state) => state.code));
const STATE_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  US_STATES.map((state) => [state.code, state.name]),
);

export function isUSStateCode(value: unknown): value is string {
  return typeof value === 'string' && STATE_CODES.has(value);
}

export function getStateName(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return STATE_NAME_BY_CODE[code] ?? null;
}

/**
 * ZIP-prefix to state lookup. The first three digits of a ZIP code map to a
 * state in nearly every case; this table covers the standard ranges and
 * matches the data Coverage Compass already uses.
 *
 * Ranges that map to multiple states have been resolved to the dominant
 * jurisdiction. Apps that need certainty for those edge cases should ask the
 * user to confirm state directly.
 */
const ZIP_PREFIX_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [600, 999, 'MA'],
  [1000, 2799, 'MA'],
  [2800, 2999, 'RI'],
  [3000, 3899, 'NH'],
  [3900, 4999, 'ME'],
  [5000, 5999, 'VT'],
  [6000, 6999, 'CT'],
  [7000, 8999, 'NJ'],
  [9000, 9999, 'NY'],
  [10000, 14999, 'NY'],
  [15000, 19699, 'PA'],
  [19700, 19999, 'DE'],
  [20000, 20599, 'DC'],
  [20600, 21999, 'MD'],
  [22000, 24699, 'VA'],
  [24700, 26999, 'WV'],
  [27000, 28999, 'NC'],
  [29000, 29999, 'SC'],
  [30000, 31999, 'GA'],
  [32000, 34999, 'FL'],
  [35000, 36999, 'AL'],
  [37000, 38599, 'TN'],
  [38600, 39799, 'MS'],
  [39800, 39999, 'GA'],
  [40000, 42799, 'KY'],
  [43000, 45999, 'OH'],
  [46000, 47999, 'IN'],
  [48000, 49999, 'MI'],
  [50000, 52999, 'IA'],
  [53000, 54999, 'WI'],
  [55000, 56999, 'MN'],
  [57000, 57999, 'SD'],
  [58000, 58999, 'ND'],
  [59000, 59999, 'MT'],
  [60000, 62999, 'IL'],
  [63000, 65999, 'MO'],
  [66000, 67999, 'KS'],
  [68000, 69999, 'NE'],
  [70000, 71499, 'LA'],
  [71600, 72999, 'AR'],
  [73000, 74999, 'OK'],
  [75000, 79999, 'TX'],
  [80000, 81999, 'CO'],
  [82000, 83199, 'WY'],
  [83200, 83899, 'ID'],
  [84000, 84999, 'UT'],
  [85000, 86999, 'AZ'],
  [87000, 88499, 'NM'],
  [88900, 89999, 'NV'],
  [90000, 96199, 'CA'],
  [96700, 96899, 'HI'],
  [97000, 97999, 'OR'],
  [98000, 99499, 'WA'],
  [99500, 99999, 'AK'],
];

export function getStateFromZip(zip: string | null | undefined): string | null {
  if (!zip) {
    return null;
  }
  const digits = zip.replace(/\D/g, '');
  if (digits.length < 3) {
    return null;
  }
  const prefix = parseInt(digits.slice(0, Math.min(digits.length, 5)) || '0', 10);
  if (Number.isNaN(prefix)) {
    return null;
  }

  for (const [low, high, code] of ZIP_PREFIX_RANGES) {
    if (prefix >= low && prefix <= high) {
      return code;
    }
  }

  return null;
}
