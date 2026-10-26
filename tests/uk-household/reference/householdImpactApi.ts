import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What the dashboard's household impact API refuses, for tests: a mirror of
 * its `POST /api/household-impact` endpoint, which takes the body as one
 * `HouseholdImpactRequest` (a model holding the others in
 * PolicyEngine/uk-autumn-budget-dashboard-2026's src/uk_budget_data/api.py).
 *
 * It reads the models' JSON schema and choices from
 * ../../fixtures/uk/household-impact-api.json, which
 * capture_household_impact_api.py writes from the dashboard's code, and
 * checks a body the way FastAPI and pydantic do: fields, types, bounds,
 * null, unknown keys, and pydantic's lax conversions (a number in text, true
 * as 1, "yes" as true). The models' four validators are copied below by
 * hand; the capture stops if one is added, removed or renamed, and
 * apiMirror.test.ts fails if one's code changes (`MIRRORED_VALIDATORS`).
 * apiMirror.test.ts also checks that every case in the fixture gets the
 * verdict and errors here that an endpoint taking these models gave it.
 *
 * Each refusal is an error from the API's 422: where
 * (`household.children.0.age`, or `(body)` for the whole body) and its type
 * (`less_than_equal`).
 */

type Schema = {
  $ref?: string;
  $defs?: Record<string, Schema>;
  additionalProperties?: boolean;
  anyOf?: Schema[];
  default?: unknown;
  enum?: string[];
  items?: Schema;
  maxItems?: number;
  maximum?: number;
  minItems?: number;
  minimum?: number;
  properties?: Record<string, Schema>;
  required?: string[];
  type?: 'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string';
};

/** A change to the base body, and pydantic's verdict on the result. */
export interface ApiCase {
  name: string;
  /** Paths given new values; `remove`: paths taken out. */
  set?: Array<[Array<string | number>, unknown]>;
  remove?: Array<Array<string | number>>;
  /** The whole body instead. */
  body?: unknown;
  /** The request of this name in dashboard-households.json instead. */
  fixture?: string;
  accepted: boolean;
  /** pydantic's errors, as `location: type`. */
  errors: string[];
}

export interface ApiCapture {
  source: {
    dashboard: string;
    commit: string;
    policyengine_uk: string;
    pydantic: string;
    pydantic_core: string;
    fastapi: string;
    starlette: string;
    seed: number;
  };
  choices: {
    policy_years: number[];
    measure_ids: string[];
    parts: string[];
    regions: string[];
    tenures: string[];
    student_loan_plans: string[];
    council_tax_bands: string[];
    brmas: string[];
    local_authorities: string[];
    oldest_child_age: number;
    salary_year: number;
  };
  schema: Schema;
  /** The code of HouseholdImpactRequest's validators, as `ast.unparse` gives it. */
  validators: Record<string, string>;
  base: Record<string, unknown>;
  cases: ApiCase[];
}

// Read rather than imported: TypeScript would infer a type for every case
const FIXTURE = join(fileURLToPath(import.meta.url), '..', '..', '..', 'fixtures', 'uk', 'household-impact-api.json');
export const API = JSON.parse(readFileSync(FIXTURE, 'utf8')) as ApiCapture;

const SCHEMA = API.schema;
const { choices } = API;
export const POLICY_YEARS: readonly number[] = choices.policy_years;
export const MEASURE_IDS: readonly string[] = choices.measure_ids;
export const REGIONS: readonly string[] = choices.regions;
export const TENURES: readonly string[] = choices.tenures;
export const PLANS: readonly string[] = choices.student_loan_plans;
export const BANDS: readonly string[] = choices.council_tax_bands;

/** A value pydantic accepted, as it holds it, or `FAILED` after an error. */
const FAILED = Symbol('failed');
type Result = unknown;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether Python reads the number's JSON text as a float: JSON.stringify
 * writes a fraction or an exponent only for a non-integer or a number of
 * 1e21 or more.
 */
const isFloatText = (value: number) => /[.e]/.test(String(value));

// How pydantic-core 2.41.5 reads text as a number (src/input/shared.rs:
// str_as_int, clean_int_str, strip_leading_zeros, str_as_float and
// strip_underscores), with jiter 0.11.1 reading the integers

// A JSON integer, as jiter reads one. It reads at most 4,300 characters of
// digits (with the minus sign); a longer run is out of range.
const JSON_INT = /^-?(?:0|[1-9][0-9]*)$/;
const JSON_INT_RUN = /^-?[1-9][0-9]*/;
const INT_CHARACTERS = 4300;
// What Rust's f64 parsing reads (inf, infinity and nan in any case)
const RUST_FLOAT = /^[+-]?(?:inf|infinity|nan|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?)$/i;
const TRUE_TEXT = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE_TEXT = new Set(['0', 'off', 'f', 'false', 'n', 'no']);
// Rust trims Unicode's White_Space characters: JavaScript's \s, but for
// U+FEFF, and with U+0085
const SPACE = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const EDGE_SPACE = new RegExp(`^${SPACE}+|${SPACE}+$`, 'g');
const trim = (text: string) => text.replace(EDGE_SPACE, '');
const INT_LIMIT = 2 ** 63;

// Underscores taken out, unless one starts or ends the text or two are
// together; undefined when there are none
function stripUnderscores(text: string): string | undefined {
  if (!text.includes('_') || text.startsWith('_') || text.endsWith('_') || text.includes('__')) return undefined;
  return text.replace(/_/g, '');
}

// Leading zeros taken out (and underscores among them), keeping one before a
// point or when the number is zero; undefined when the text does not start
// with a digit or a minus sign
function stripLeadingZeros(text: string): string | undefined {
  if (text[0] !== '0') return /^[1-9-]/.test(text) ? text : undefined;
  for (let index = 1; index < text.length; index++) {
    const character = text[index];
    if (character === '0' || character === '_') continue;
    if (/[1-9-]/.test(character)) return text.slice(index);
    if (character === '.') return text.slice(index - 1);
    return undefined;
  }
  return text.slice(-1);
}

// The text jiter reads again when it could not read it as it was: trimmed,
// a leading + taken out, leading zeros taken out, a point followed only by
// zeros taken out, and underscores taken out
function cleanIntText(text: string): string | undefined {
  let rest = trim(text);
  if (rest.startsWith('+')) {
    if (rest[1] === '-') return undefined;
    rest = rest.slice(1);
  }
  let sign = '';
  if (rest.startsWith('-')) {
    if (rest[1] === '-' || rest[1] === '+') return undefined;
    sign = '-';
    rest = rest.slice(1);
  }
  const unpadded = stripLeadingZeros(rest);
  if (unpadded === undefined) return undefined;
  rest = unpadded;
  const point = rest.indexOf('.');
  if (point >= 0 && /^0+$/.test(rest.slice(point + 1))) rest = rest.slice(0, point);
  return sign + (stripUnderscores(rest) ?? rest);
}

const floatOf = (text: string) => {
  const word = /^([+-]?)(inf|infinity|nan)$/i.exec(text);
  if (!word) return Number(text);
  if (word[2].toLowerCase() === 'nan') return Number.NaN;
  return word[1] === '-' ? -Infinity : Infinity;
};

// Rust's eq_ignore_ascii_case: only A to Z are folded
const asciiLower = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

class Check {
  readonly errors: string[] = [];

  fail(loc: string, type: string): typeof FAILED {
    this.errors.push(`${loc || '(body)'}: ${type}`);
    return FAILED;
  }

  value(schema: Schema, value: unknown, loc: string): Result {
    if (schema.$ref) return this.value(definition(schema.$ref), value, loc);
    if (schema.anyOf) {
      // Optional[X]: null, or what X takes
      const [other, nullable, ...rest] = schema.anyOf;
      if (nullable?.type !== 'null' || rest.length > 0) throw new Error(`Unmirrored anyOf at ${loc}`);
      return value === null ? null : this.value(other, value, loc);
    }
    if (schema.enum) {
      return typeof value === 'string' && schema.enum.includes(value) ? value : this.fail(loc, 'literal_error');
    }
    switch (schema.type) {
      case 'integer':
        return this.bounded(schema, this.integer(value, loc), loc);
      case 'number':
        return this.bounded(schema, this.float(value, loc), loc);
      case 'boolean':
        return this.boolean(value, loc);
      case 'string':
        return typeof value === 'string' ? value : this.fail(loc, 'string_type');
      case 'array':
        return this.array(schema, value, loc);
      case 'object':
        return this.object(schema, value, loc);
      default:
        throw new Error(`Unmirrored schema at ${loc}: ${JSON.stringify(schema)}`);
    }
  }

  integer(value: unknown, loc: string): Result {
    if (typeof value === 'boolean') return Number(value);
    if (typeof value === 'number') {
      if (!isFloatText(value)) return value;
      if (!Number.isInteger(value)) return this.fail(loc, 'int_from_float');
      return Math.abs(value) >= INT_LIMIT ? this.fail(loc, 'int_parsing_size') : value;
    }
    if (typeof value === 'string') {
      // jiter reads the text as it is first: a run of digits too long for it
      // is int_parsing_size, then; after cleaning, int_parsing
      if ((JSON_INT_RUN.exec(value)?.[0].length ?? 0) > INT_CHARACTERS) return this.fail(loc, 'int_parsing_size');
      const text = JSON_INT.test(value) ? value : cleanIntText(value);
      return text !== undefined && JSON_INT.test(text) && text.length <= INT_CHARACTERS
        ? Number(text)
        : this.fail(loc, 'int_parsing');
    }
    return this.fail(loc, 'int_type');
  }

  float(value: unknown, loc: string): Result {
    if (typeof value === 'boolean') return Number(value);
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      // The trimmed text, or else the text with its underscores taken out,
      // untrimmed
      const text = trim(value);
      if (RUST_FLOAT.test(text)) return floatOf(text);
      const stripped = stripUnderscores(value);
      return stripped !== undefined && RUST_FLOAT.test(stripped) ? floatOf(stripped) : this.fail(loc, 'float_parsing');
    }
    return this.fail(loc, 'float_type');
  }

  // pydantic checks the upper bound first, so NaN fails it
  bounded(schema: Schema, value: Result, loc: string): Result {
    if (value === FAILED) return value;
    const number = value as number;
    if (schema.maximum !== undefined && !(number <= schema.maximum)) return this.fail(loc, 'less_than_equal');
    if (schema.minimum !== undefined && !(number >= schema.minimum)) return this.fail(loc, 'greater_than_equal');
    return number;
  }

  boolean(value: unknown, loc: string): Result {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      // A float, or an integer past an int64, is not one pydantic reads as a bool
      if (isFloatText(value) || Math.abs(value) >= INT_LIMIT) return this.fail(loc, 'bool_type');
      return value === 0 || value === 1 ? value === 1 : this.fail(loc, 'bool_parsing');
    }
    if (typeof value === 'string') {
      const text = asciiLower(value);
      if (TRUE_TEXT.has(text)) return true;
      if (FALSE_TEXT.has(text)) return false;
      return this.fail(loc, 'bool_parsing');
    }
    return this.fail(loc, 'bool_type');
  }

  array(schema: Schema, value: unknown, loc: string): Result {
    if (!Array.isArray(value)) return this.fail(loc, 'list_type');
    // A list over the limit is refused for its length alone
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return this.fail(loc, 'too_long');
    const before = this.errors.length;
    const items = value.map((item, index) => this.value(schema.items!, item, `${loc}.${index}`));
    if (this.errors.length > before) return FAILED;
    if (schema.minItems !== undefined && items.length < schema.minItems) return this.fail(loc, 'too_short');
    return items;
  }

  // FastAPI validates with from_attributes=True, under which pydantic names a
  // value that is not an object model_attributes_type
  object(schema: Schema, value: unknown, loc: string): Result {
    if (!isObject(value)) return this.fail(loc, 'model_attributes_type');
    const at = (key: string) => (loc ? `${loc}.${key}` : key);
    const before = this.errors.length;
    const properties = schema.properties ?? {};
    const fields: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) fields[key] = this.value(property, value[key], at(key));
      else if (schema.required?.includes(key)) this.fail(at(key), 'missing');
      else fields[key] = property.default;
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) this.fail(at(key), 'extra_forbidden');
    }
    return this.errors.length > before ? FAILED : fields;
  }
}

function definition(ref: string): Schema {
  const name = ref.replace('#/$defs/', '');
  const found = SCHEMA.$defs?.[name];
  if (!found) throw new Error(`No schema for ${ref}`);
  return found;
}

/**
 * The validators `apiRefusals` copies, in the code it copied them from. When
 * the dashboard changes one, the captured code stops matching this
 * (apiMirror.test.ts): copy the new rule into `apiRefusals`, then its code
 * here.
 */
export const MIRRORED_VALIDATORS: Record<string, string> = {
  _salary_year: `@field_validator('household')
@classmethod
def _salary_year(cls, household: 'HouseholdAnswersRequest'):
    if household.salary_year not in POLICY_YEARS:
        raise ValueError(f'household.salary_year: choose a year from {POLICY_YEARS[0]} to {POLICY_YEARS[-1]}')
    return household`,
  _salary_not_after_year: `@model_validator(mode='after')
def _salary_not_after_year(self):
    if self.household.salary_year > self.year:
        raise ValueError('household.salary_year must not be after year: salaries are grown forward to the chosen year')
    return self`,
  _policy_year: `@field_validator('year')
@classmethod
def _policy_year(cls, year: int) -> int:
    if year not in POLICY_YEARS:
        raise ValueError(f'Choose a year from {POLICY_YEARS[0]} to {POLICY_YEARS[-1]}')
    return year`,
  _known_measures: `@field_validator('policies')
@classmethod
def _known_measures(cls, policies: Optional[list[str]]):
    if policies is None:
        return policies
    unknown = sorted(set(policies) - set(household_impact.measure_ids()))
    if unknown:
        raise ValueError(f"Unknown measures: {', '.join(unknown)}")
    return policies`,
};

/** The reasons the API would refuse a request body (sent as JSON), or none. */
export function apiRefusals(body: unknown): string[] {
  // The API sees the JSON text: undefined fields are left out
  const request: unknown = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
  const check = new Check();
  const properties = SCHEMA.properties!;
  // FastAPI reads an empty body, and null, as no body
  if (request === undefined || request === null) {
    check.fail('', 'missing');
    return check.errors;
  }
  if (!isObject(request)) {
    check.fail('', 'model_attributes_type');
    return check.errors;
  }
  const field = (key: string) => (Object.hasOwn(request, key) ? check.value(properties[key], request[key], key) : undefined);
  const before = check.errors.length;

  // HouseholdImpactRequest's validators, from api.py: _policy_year,
  // _known_measures and _salary_year check one field each once it is
  // valid, and _salary_not_after_year the whole body once every field is
  const year = Object.hasOwn(request, 'year') ? field('year') : check.fail('year', 'missing');
  if (year !== FAILED && !POLICY_YEARS.includes(year as number)) check.fail('year', 'value_error');
  const policies = field('policies');
  if (Array.isArray(policies) && policies.some((id) => !MEASURE_IDS.includes(id as string))) {
    check.fail('policies', 'value_error');
  }
  // pydantic does not validate a default, so _salary_year sees only a
  // household that was sent
  const householdDefaults = definition(properties.household.$ref!).properties!;
  const sent = Object.hasOwn(request, 'household');
  const household = sent ? field('household') : { salary_year: householdDefaults.salary_year.default };
  if (sent && household !== FAILED) {
    const salaryYear = (household as { salary_year: number }).salary_year;
    if (!POLICY_YEARS.includes(salaryYear)) check.fail('household', 'value_error');
  }
  field('include');
  for (const key of Object.keys(request)) if (!Object.hasOwn(properties, key)) check.fail(key, 'extra_forbidden');

  if (check.errors.length === before) {
    const salaryYear = (household as { salary_year: number }).salary_year;
    if (salaryYear > (year as number)) check.fail('', 'value_error');
  }
  return check.errors;
}
