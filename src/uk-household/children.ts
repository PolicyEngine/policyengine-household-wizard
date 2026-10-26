/**
 * The oldest age a child can have. policyengine-uk's qualifying young person
 * is under 20, and the household impact API refuses a child of 20 or over
 * (`HouseholdChildRequest.age`, `le=19`).
 */
export const UK_OLDEST_CHILD_AGE = 19;

/**
 * From this age, whether a child is in full-time non-advanced education
 * decides whether they count as a dependant.
 */
export const UK_YOUNG_PERSON_AGE = 16;

/** What to tell someone who enters a child of 20 or over. */
export const UK_CHILD_AGE_MESSAGE =
  'Children are 0 to 19. Someone aged 20 or over is not a dependant for Child Benefit or Universal Credit, so leave them out.';

/** Whether a child of `age` is asked about education: from 16 to 19. */
export const asksEducation = (age: number | null | undefined): boolean =>
  (age as number) >= UK_YOUNG_PERSON_AGE && (age as number) <= UK_OLDEST_CHILD_AGE;

/** The age a new child starts at in a form that adds one (`setChildCount`). */
export const UK_NEW_CHILD_AGE = 5;
