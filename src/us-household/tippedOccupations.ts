/**
 * Treasury Tipped Occupation Codes (TTOCs): the occupations whose tips can
 * qualify for the federal deduction for qualified tips (26 U.S.C. 224) in tax
 * years 2025 through 2028.
 *
 * Source: Table 1 to paragraph (h) of 26 CFR 1.224-1, "Occupations that
 * Customarily and Regularly Received Tips on or Before December 31, 2024",
 * final regulations T.D. 10044, Internal Revenue Bulletin 2026-18
 * (April 27, 2026), https://www.irs.gov/pub/irs-irbs/irb26-18.pdf. The final
 * table lists 71 occupations; it adds 509, 510 and 810 to the proposed
 * regulations' list (IRB 2025-42) and renames 103, 506 and 606. Labels are the
 * table's occupation titles in sentence case.
 *
 * PolicyEngine US reads the code as `treasury_tipped_occupation_code`, where 0
 * means the person did not receive tips in a listed occupation. Its deduction
 * checks only that the code is above 0, so the code itself does not change
 * results; the list lets apps ask the question the law asks.
 */

export interface TippedOccupation {
  /** Treasury Tipped Occupation Code. */
  code: number;
  /** Occupation title, in sentence case. */
  label: string;
  /** The table's category heading, in sentence case. */
  category: string;
}

/** The code for "no listed occupation", which PolicyEngine US also uses. */
export const NOT_A_TIPPED_OCCUPATION = 0;

const CATEGORIES: Record<number, string> = {
  1: 'Beverage and food service',
  2: 'Entertainment and events',
  3: 'Hospitality and guest services',
  4: 'Home services',
  5: 'Personal services',
  6: 'Personal appearance and wellness',
  7: 'Recreation and instruction',
  8: 'Transportation and delivery',
};

const TITLES: ReadonlyArray<[number, string]> = [
  [101, 'Bartenders'],
  [102, 'Wait staff'],
  [103, 'Food or beverage servers, non-restaurant'],
  [104, 'Dining room and cafeteria attendants and bartender helpers'],
  [105, 'Chefs and cooks'],
  [106, 'Food preparation workers'],
  [107, 'Fast food and counter workers'],
  [108, 'Dishwashers'],
  [109, 'Host staff, restaurant, lounge, and coffee shop'],
  [110, 'Bakers'],
  [201, 'Gambling dealers'],
  [202, 'Gambling change persons and booth cashiers'],
  [203, 'Gambling cage workers'],
  [204, 'Gambling and sports book writers and runners'],
  [205, 'Dancers'],
  [206, 'Musicians and singers'],
  [207, 'Disc jockeys, except radio'],
  [208, 'Entertainers and performers'],
  [209, 'Digital content creators'],
  [210, 'Ushers, lobby attendants, and ticket takers'],
  [211, 'Locker room, coatroom, and dressing room attendants'],
  [301, 'Baggage porters and bellhops'],
  [302, 'Concierges'],
  [303, 'Hotel, motel, and resort desk clerks'],
  [304, 'Maids and housekeeping cleaners'],
  [401, 'Home maintenance and repair workers'],
  [402, 'Home landscaping and groundskeeping workers'],
  [403, 'Home electricians'],
  [404, 'Home plumbers'],
  [405, 'Home heating and air conditioning mechanics and installers'],
  [406, 'Home appliance installers and repairers'],
  [407, 'Home cleaning service workers'],
  [408, 'Locksmiths'],
  [409, 'Roadside assistance workers'],
  [501, 'Personal care and service workers'],
  [502, 'Private event planners'],
  [503, 'Private event and portrait photographers'],
  [504, 'Private event videographers'],
  [505, 'Event officiants'],
  [506, 'Pet and show animal caretakers'],
  [507, 'Tutors'],
  [508, 'Nannies and babysitters'],
  [509, 'Visual artists'],
  [510, 'Floral designers'],
  [601, 'Skincare specialists'],
  [602, 'Massage therapists'],
  [603, 'Barbers, hairdressers, hairstylists, and cosmetologists'],
  [604, 'Shampooers'],
  [605, 'Manicurists and pedicurists'],
  [606, 'Eyebrow and eyelash technicians'],
  [607, 'Makeup artists'],
  [608, 'Exercise trainers and group fitness instructors'],
  [609, 'Tattoo artists and piercers'],
  [610, 'Tailors'],
  [611, 'Shoe and leather workers and repairers'],
  [701, 'Golf caddies'],
  [702, 'Self-enrichment teachers'],
  [703, 'Recreational and tour pilots'],
  [704, 'Tour guides'],
  [705, 'Travel guides'],
  [706, 'Sports and recreation instructors'],
  [801, 'Parking and valet attendants'],
  [802, 'Taxi and rideshare drivers and chauffeurs'],
  [803, 'Shuttle drivers'],
  [804, 'Goods delivery people'],
  [805, 'Personal vehicle and equipment cleaners'],
  [806, 'Private and charter bus drivers'],
  [807, 'Water taxi operators and charter boat workers'],
  [808, 'Rickshaw, pedicab, and carriage drivers'],
  [809, 'Home movers'],
  [810, 'Gas pump attendant'],
];

/** Every listed occupation, in code order. */
export const TIPPED_OCCUPATIONS: ReadonlyArray<TippedOccupation> = TITLES.map(
  ([code, label]) => ({ code, label, category: CATEGORIES[Math.floor(code / 100)] }),
);

const BY_CODE = new Map(TIPPED_OCCUPATIONS.map((occupation) => [occupation.code, occupation]));

export function getTippedOccupation(code: number): TippedOccupation | undefined {
  return BY_CODE.get(code);
}

export function isTippedOccupationCode(code: unknown): code is number {
  return typeof code === 'number' && BY_CODE.has(code);
}

/**
 * An entered occupation code as a number the V1 adapter sends: a listed code,
 * or 0 for "not a listed occupation". Numeric strings are read as numbers.
 * Anything else, including codes the table does not list, reads as not
 * answered, so a stray value cannot claim the deduction.
 */
export function toTippedOccupationCode(value: unknown): number | undefined {
  const code = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (code === NOT_A_TIPPED_OCCUPATION) {
    // Also reads -0 as 0.
    return NOT_A_TIPPED_OCCUPATION;
  }
  return isTippedOccupationCode(code) ? code : undefined;
}
