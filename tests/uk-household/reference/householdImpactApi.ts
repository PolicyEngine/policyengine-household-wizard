import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What the dashboard's household impact API refuses, for tests: a mirror of
 * the validation its `POST /api/household-impact` endpoint does, which takes
 * the body as one `HouseholdImpactRequest` (a model holding the others in
 * PolicyEngine/uk-autumn-budget-dashboard-2026's src/uk_budget_data/api.py).
 *
 * It reads the models' JSON schema and choices from
 * ../../fixtures/uk/household-impact-api.json, which
 * capture_household_impact_api.py writes by running the dashboard's own app,
 * and checks a body the way FastAPI and pydantic do: fields, types, bounds,
 * null, unknown keys, and pydantic's lax conversions (a number in text, true
 * as 1, "yes" as true). The models' four validators are copied below by
 * hand, and the pydantic features it implements are listed; apiMirror.test.ts
 * fails if a validator's code changes, one is added, or the models use
 * another feature (`MIRRORED_VALIDATORS`, `MIRRORED_FEATURES`), and checks
 * that every case in the fixture gets the API's verdict here. It also fails
 * when any other code of the dashboard's that runs while the API answers
 * changes (`REVIEWED_DASHBOARD_CODE`), or any file of the dashboard's the
 * API loads or reads (`REVIEWED_DASHBOARD_FILES`), until it is read again.
 *
 * A refusal is a list of FastAPI's errors: where
 * (`household.children.0.age`, or `(body)` for the whole body) and its type
 * (`less_than_equal`). The API answers them with a 422, or a 500 when one's
 * input holds an unpaired surrogate (`"\ud800"`), which UTF-8 cannot write.
 *
 * It covers the validation FastAPI does before the endpoint runs, not what
 * the endpoint's own code refuses once it runs: in api.py, a `ValueError` is
 * a 400, a calculation past its time limit a 504 and any other error a 500.
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

/** A change to the base body, and the API's verdict on the result. */
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
  /** The errors FastAPI reports, as `location: type`. */
  errors: string[];
  /** 500 when the API could not write its 422, or raised before it had one. */
  status?: 500;
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
  /** The code of the models' validators, as `ast.unparse` gives it. */
  validators: Record<string, string>;
  /** The pydantic features the models' core schema uses. */
  features: string[];
  /**
   * The dashboard's other functions that ran while the API answered the
   * cases (its endpoint, the code before and after the calculation, its
   * lifespan), by module and name: their code as `ast.unparse` gives it,
   * without docstrings.
   */
  code: Record<string, string>;
  /**
   * The sha256 of each of the dashboard's files the API's process loaded
   * as a module or opened, by path: a Python file's code as `ast.unparse`
   * gives it without docstrings, another file's bytes.
   */
  files: Record<string, string>;
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

// Half of a surrogate pair without the other half
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function holdsLoneSurrogate(value: unknown): boolean {
  if (typeof value === 'string') return LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.some(holdsLoneSurrogate);
  if (isObject(value)) {
    return Object.entries(value).some(([key, item]) => LONE_SURROGATE.test(key) || holdsLoneSurrogate(item));
  }
  return false;
}

/**
 * Whether Python reads the number's JSON text as a float: JSON.stringify
 * writes a fraction or an exponent only for a non-integer or a number of
 * 1e21 or more.
 */
const isFloatText = (value: number) => /[.e]/.test(String(value));

// How pydantic-core 2.41.5 reads text as a number (src/input/shared.rs:
// str_as_int, clean_int_str, strip_leading_zeros, str_as_float and
// strip_underscores), with jiter 0.11.1 reading the integers

// A JSON integer, as jiter reads one. It reads a run of at most 4,300
// characters, the minus sign included; a longer run is out of range.
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

// Leading zeros taken out, with underscores among them. The character before
// a point is kept, or the last character when nothing else follows (either
// can be an underscore, which then fails). Undefined when the text does not
// start with a digit or a minus sign, or its leading zeros are followed by
// anything but a digit, a minus sign or a point.
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

/** An error, and whether UTF-8 can write it: not when its input holds an unpaired surrogate. */
interface Failure {
  error: string;
  writable: boolean;
}

/** pydantic-core raises, before it reports any error, on a validator's message holding an unpaired surrogate. */
class Unreported extends Error {}

class Check {
  readonly failures: Failure[] = [];

  /** An error at `loc`, whose input (as pydantic reports it) is `input`. */
  fail(loc: string, type: string, input: unknown): typeof FAILED {
    this.failures.push({ error: `${loc || '(body)'}: ${type}`, writable: !holdsLoneSurrogate(input) });
    return FAILED;
  }

  // An object holding a key with an unpaired surrogate is refused for that
  // alone: pydantic-core reads the keys, once the fields are checked, as
  // UTF-8, and drops the object's other errors
  keys(value: Record<string, unknown>, loc: string, since: number): boolean {
    if (!Object.keys(value).some((key) => LONE_SURROGATE.test(key))) return false;
    this.failures.length = since;
    this.fail(loc, 'string_unicode', value);
    return true;
  }

  value(schema: Schema, value: unknown, loc: string): Result {
    if (schema.$ref) return this.value(definition(schema.$ref), value, loc);
    if (schema.anyOf) {
      // Optional[X]: null, or what X takes
      const [other, nullable, ...rest] = schema.anyOf;
      if (nullable?.type !== 'null' || rest.length > 0) throw new Error(`Unmirrored anyOf at ${loc}`);
      return value === null ? null : this.value(other, value, loc);
    }
    // pydantic-core reads text as UTF-8 for a choice, a number or a boolean
    // (not for text it keeps as text), which an unpaired surrogate is not
    const reads = schema.enum !== undefined || ['integer', 'number', 'boolean'].includes(schema.type!);
    if (reads && typeof value === 'string' && LONE_SURROGATE.test(value)) return this.fail(loc, 'string_unicode', value);
    if (schema.enum) {
      return typeof value === 'string' && schema.enum.includes(value) ? value : this.fail(loc, 'literal_error', value);
    }
    switch (schema.type) {
      case 'integer':
        return this.bounded(schema, this.integer(value, loc), loc);
      case 'number':
        return this.bounded(schema, this.float(value, loc), loc);
      case 'boolean':
        return this.boolean(value, loc);
      case 'string':
        return typeof value === 'string' ? value : this.fail(loc, 'string_type', value);
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
      if (!Number.isInteger(value)) return this.fail(loc, 'int_from_float', value);
      return Math.abs(value) >= INT_LIMIT ? this.fail(loc, 'int_parsing_size', value) : value;
    }
    if (typeof value === 'string') {
      // jiter reads the text as it is first: a run of digits too long for it
      // is int_parsing_size, then; after cleaning, int_parsing
      if ((JSON_INT_RUN.exec(value)?.[0].length ?? 0) > INT_CHARACTERS) return this.fail(loc, 'int_parsing_size', value);
      const text = JSON_INT.test(value) ? value : cleanIntText(value);
      return text !== undefined && JSON_INT.test(text) && text.length <= INT_CHARACTERS
        ? Number(text)
        : this.fail(loc, 'int_parsing', value);
    }
    return this.fail(loc, 'int_type', value);
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
      return stripped !== undefined && RUST_FLOAT.test(stripped) ? floatOf(stripped) : this.fail(loc, 'float_parsing', value);
    }
    return this.fail(loc, 'float_type', value);
  }

  // pydantic checks the upper bound first, so NaN fails it
  bounded(schema: Schema, value: Result, loc: string): Result {
    if (value === FAILED) return value;
    const number = value as number;
    if (schema.maximum !== undefined && !(number <= schema.maximum)) return this.fail(loc, 'less_than_equal', number);
    if (schema.minimum !== undefined && !(number >= schema.minimum)) return this.fail(loc, 'greater_than_equal', number);
    return number;
  }

  boolean(value: unknown, loc: string): Result {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      // A float, or an integer past an int64, is not one pydantic reads as a bool
      if (isFloatText(value) || Math.abs(value) >= INT_LIMIT) return this.fail(loc, 'bool_type', value);
      return value === 0 || value === 1 ? value === 1 : this.fail(loc, 'bool_parsing', value);
    }
    if (typeof value === 'string') {
      const text = asciiLower(value);
      if (TRUE_TEXT.has(text)) return true;
      if (FALSE_TEXT.has(text)) return false;
      return this.fail(loc, 'bool_parsing', value);
    }
    return this.fail(loc, 'bool_type', value);
  }

  array(schema: Schema, value: unknown, loc: string): Result {
    if (!Array.isArray(value)) return this.fail(loc, 'list_type', value);
    // A list over the limit is refused for its length alone
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return this.fail(loc, 'too_long', value);
    const before = this.failures.length;
    const items = value.map((item, index) => this.value(schema.items!, item, `${loc}.${index}`));
    if (this.failures.length > before) return FAILED;
    if (schema.minItems !== undefined && items.length < schema.minItems) return this.fail(loc, 'too_short', value);
    return items;
  }

  // FastAPI validates with from_attributes=True, under which pydantic names a
  // value that is not an object model_attributes_type
  object(schema: Schema, value: unknown, loc: string): Result {
    if (!isObject(value)) return this.fail(loc, 'model_attributes_type', value);
    const at = (key: string) => (loc ? `${loc}.${key}` : key);
    const before = this.failures.length;
    const properties = schema.properties ?? {};
    const fields: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) fields[key] = this.value(property, value[key], at(key));
      // A missing field's input is the object it is missing from
      else if (schema.required?.includes(key)) this.fail(at(key), 'missing', value);
      else fields[key] = property.default;
    }
    if (schema.additionalProperties !== false) throw new Error(`Unmirrored extra keys at ${loc}`);
    if (this.keys(value, loc, before)) return FAILED;
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) this.fail(at(key), 'extra_forbidden', value[key]);
    }
    return this.failures.length > before ? FAILED : fields;
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

/**
 * The sha256 of the code of each of the dashboard's functions that ran while
 * the API answered the cases (`API.code`), apart from the validators, as read
 * at bd346f30. Apart from FastAPI's validation, which this mirror follows,
 * that code refuses only a malformed `definition` query (a 400), which the
 * package never sends. The rest checks the request again from its own JSON,
 * builds the answers, picks the measures and the workers, times the
 * calculation, keeps answers by request, and stops the workers at shutdown.
 * When the dashboard changes one, add one or runs another, apiMirror.test.ts
 * fails: read the new code in the fixture's `code`, follow in this mirror
 * anything it refuses before the calculation, then record its hash here.
 */
export const REVIEWED_DASHBOARD_CODE: Record<string, string> = {
  'src/uk_budget_data/api.py:HouseholdAnswersRequest.answers': '76314c442ec259f81e9fa53767fbe87d86c1bd35e25d1bebdfafcc1efcefeeea',
  'src/uk_budget_data/api.py:HouseholdImpactRequest.<lambda>': '1b61e84fdea2e57b654e4748157ad60043a0461446f0824d365b9be40a1bbf3b',
  'src/uk_budget_data/api.py:_cached_household_impact': 'e81ed6241b4eb9b3cfc0ee750079443ed775cf1a2eed555e78a3c85bfd8eb844',
  'src/uk_budget_data/api.py:_household_impact': '495d9f8eb79a5e8b18866c79793d6784df562ad221f76d6bdc56b9a1d4db1425',
  'src/uk_budget_data/api.py:calculate_household_impact': 'e1c4020ff06078fa91aa9a6ed8cbf7b5e9903b289aa9a4c8c407a1cad0c4aa8a',
  'src/uk_budget_data/api.py:lifespan': '24ce3fa98dff567aa32ff88ba6e8fa9442c04d9c3e80073860c6bf5c0e0f7a20',
  'src/uk_budget_data/api.py:memory_peak_bytes': '8819a1d179614b253eb08507862a0c1e82c0e93d62217ec853563a1e00c3e21b',
  'src/uk_budget_data/api.py:server_timing': '086a8facc9e8fb83f09cd29e8fc7afd450094958cfbd67eb09dc874887b8c837',
  'src/uk_budget_data/api.py:timed': '8c3a0335ccff0165b17faa8c746e26af7c8e0568f3ec09c4f4bc0505ae20156d',
  'src/uk_budget_data/definitions.py:definitions_for': 'e0a8b2e91e821106e49afb12a4edce6efc4134c1663a4b60de62225b91e7e6d8',
  'src/uk_budget_data/definitions.py:parse_requested': '1fbd90b2f78bab6736f9f1a879a58e10676ee55c735734d27f6038f02e58e380',
  'src/uk_budget_data/household_impact.py:measure_ids': '3cf01b2af4f5b2769eff49e5f19cdc6cecf90aff5e3cb122596cf0699f7695b9',
  'src/uk_budget_data/personal_impact.py:household_workers': '045c75b2b16f827f6353182df2d5acdebe735a7405fdad9a59761f20c52164f9',
  'src/uk_budget_data/personal_impact.py:stop_workers': '39b0bd813b238dca928777964bd0eec50c88d5d96d612baea7805b268c262030',
  'src/uk_budget_data/reforms.py:_get_autumn_budget_2026_reforms': '4382b625501e0fbd981573da05cb4b2a10c93ca74b347497733147f63cdbfc5e',
  'src/uk_budget_data/reforms.py:get_autumn_budget_2026_reforms': 'b40bf0549bf9e5ad51c50eeb133f97cdd5cc8ae3f26ea533b2fde427a1755644',
};

/**
 * The sha256 of each of the dashboard's files the API's process loads or
 * opens (`API.files`), as read at the commit below: 31 Python modules and
 * budget_years.json. At import they build the app, its middleware and
 * routes, the models, the reform list and the data tables, read
 * budget_years.json and the environment for the worker and request limits,
 * and call policyengine's recorder of the versions loaded; none of it
 * changes pydantic, FastAPI or Starlette. A change to any of these files,
 * a new one, or one no longer loaded makes apiMirror.test.ts fail: read
 * `git diff <commit> <the new commit> -- <the files>` in the dashboard,
 * follow in this mirror anything that changes what the API refuses before
 * the calculation, then record the new commit and hashes here.
 */
export const REVIEWED_DASHBOARD_FILES: { commit: string; files: Record<string, string> } = {
  commit: 'bd346f300708b2fe4ad358e850bca546b9ffc3d4',
  files: {
    'src/uk_budget_data/__init__.py': '12a819e71709b113828c6354c5ed4b8c946a3be6c08d85ffa1012b8bc3673807',
    'src/uk_budget_data/api.py': '7d5e9ad61f89087ff98746b4c8253da53db0e91ae41d5ec44bb568214af803d8',
    'src/uk_budget_data/budget_measures/__init__.py': 'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1',
    'src/uk_budget_data/budget_measures/connect_student_loan_repayments.py': 'cc91e585d308001c8e7a902d0a621cce142b39b67b979236389e0fb68a8ec4e2',
    'src/uk_budget_data/budget_measures/employer_ni_relief_ages_21_to_24.py': '063816a303c646ea6f1aa9127f6e45d9e9345d01bd6bba8de5516a8c7b3a5db2',
    'src/uk_budget_data/budget_measures/pump_vat_on_fuel_duty_deferral.py': '36a670dc921d4426951b1ba7af15f593780a3fad3106044a7b88453264c62a0a',
    'src/uk_budget_data/budget_measures/road_fuel_vat_cut.py': 'f50f794036f796d0d543354b221fda147dc1e9f8a0ab57bbbb96c5179f976c4b',
    'src/uk_budget_data/budget_measures/state_pension_income_tax_allowance.py': '11a23d0325e44707502c42d5e7a854b528d865a678ae42ea311393fd1495bdee',
    'src/uk_budget_data/budget_measures/warm_home_discount_top_up.py': 'a9ce3d9d5428bc8190160864839fac8e668e57ad9ecc44ceec13a0362f027f47',
    'src/uk_budget_data/budget_measures/zero_vat_on_domestic_electricity.py': '5a16b69c676aa0dde9a450713f8de11e39c36bc27564ec0aaa4e52644f245b25',
    'src/uk_budget_data/budget_years.json': '8f03e13e0cbb80c286625a7773a717c285d4aae1420055825c3a0106a7c87823',
    'src/uk_budget_data/budget_years.py': '787128ae63dd872ecfcaf02210141492e394f74973b70f63438a94e2d8c4c5fb',
    'src/uk_budget_data/calculators.py': 'aa2d7378bbe58eb858a0c7980bb062b9b5a0ce7034885647abc48559c7ba8845',
    'src/uk_budget_data/certified_data.py': '8fa8d7ffac7ea14402474026ae518bf0b11a2f5361b2af3cf06bc9bc9f07e7f3',
    'src/uk_budget_data/data_limits.py': 'e5ba0998e2e0369f53a7a66f4a743d53d3a3fc3e12ae59858b1f75e73d20ed93',
    'src/uk_budget_data/definitions.py': '8ce794cc07bcbed14851ef535da2bc3e7476b64e9966d9a919ddeaba14ac8ddc',
    'src/uk_budget_data/household_impact.py': '3481e192ca45e324f2665583ab4bcefd7e135c5a5a4b5958cdfb93314a455c49',
    'src/uk_budget_data/measure_templates.py': 'bb839020902fbf8bddee1fa173cefe368674b5a14f9b2d80e4b02341c7fdfd25',
    'src/uk_budget_data/model_limits.py': '4c0a8ac198b5592d952f228ee6ca79aa31ac77c7819357be9d3b163c6a884013',
    'src/uk_budget_data/models.py': '093c55bb28182a0da865681f92c2c5f52249c2346c12dc9361da6e6698d5bed0',
    'src/uk_budget_data/personal_impact.py': '35818e981dda71520e23bac6f244d5997d7d7f7ca3e1006925e101e63e6dbc47',
    'src/uk_budget_data/pipeline.py': '79c8cbebe7e64dd36248b9542b85b678df6c87df0696956e6c8a023a2c7376fd',
    'src/uk_budget_data/private_outputs.py': 'f169e8673edc11904d3fc5ef468f0e3ba8edb48904b1ee5fdea59e61b257389a',
    'src/uk_budget_data/publication/__init__.py': 'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1',
    'src/uk_budget_data/publication/artifacts.py': 'cec2ef638efb74640243bec4574178da585af1609416c65c85f80c3c2a3939f9',
    'src/uk_budget_data/publication/combine.py': 'e75fec0b44e467ef0532bf25e2d7880adf480d4ea556273aa0748d612bdb6b4e',
    'src/uk_budget_data/publication/receipt.py': '4687a754857a7a209f4008ab7ad38410e1b3017c1c6bab22a6452874380e45a5',
    'src/uk_budget_data/publication/tables.py': '7fcfb924582ea222fcc3668aabddaf7c8839c10dc20111feab0de26d81dc621a',
    'src/uk_budget_data/publication/template_proof.py': '26e562365009cddce62330b7956fabe65360841f7b4ea2c36622ae4c4d2a8a3a',
    'src/uk_budget_data/reforms.py': '47da57f216db99197cf697e7004d2ba62e19ae17302f4355cf69a4541922c07b',
    'src/uk_budget_data/runtime_identity.py': 'dfd5e5438166dbf3baeb791e7ef0d5db8eb778508d432519def683c1de96a769',
    'src/uk_budget_data/scored_years.py': 'b37938878a2e18e13b75d59f2fe0a8386cc6bc2c4b34b5b377c0866654c2e6fe',
  },
};

/**
 * The pydantic features of the models' core schema (as the capture lists
 * them: `type`, `type.key` or `type.key=value`) that `validate` implements.
 * Another one, such as `int.strict=True` or `float.gt`, changes what the API
 * accepts in a way this mirror does not follow: implement it, then list it.
 */
export const MIRRORED_FEATURES: readonly string[] = [
  'bool',
  'default',
  'default.default',
  'default.default_factory',
  'default.default_factory_takes_data=False',
  'default.schema',
  'float',
  'float.ge',
  'float.le',
  'function-after',
  'function-after.function.no-info',
  'function-after.schema',
  'int',
  'int.ge',
  'int.le',
  'list',
  'list.items_schema',
  'list.max_length',
  'list.min_length',
  'literal',
  'literal.expected',
  'model',
  'model-field',
  'model-field.schema',
  'model-fields',
  'model-fields.fields',
  "model.config.extra_fields_behavior='forbid'",
  'model.custom_init=False',
  'model.root_model=False',
  'model.schema',
  'nullable',
  'nullable.schema',
  'str',
];

/** The API's verdict on a body: accepted, or FastAPI's errors and the status it answers them with. */
export interface ApiVerdict {
  accepted: boolean;
  /** As `location: type`, sorted; none for a 500 raised before any error. */
  errors: string[];
  status: 200 | 422 | 500;
}

/** The API's verdict on a request body, sent as JSON. */
export function apiVerdict(body: unknown): ApiVerdict {
  let check: Check;
  try {
    check = validate(body);
  } catch (error) {
    if (error instanceof Unreported) return { accepted: false, errors: [], status: 500 };
    throw error;
  }
  const errors = [...new Set(check.failures.map((failure) => failure.error))].sort();
  if (errors.length === 0) return { accepted: true, errors, status: 200 };
  return { accepted: false, errors, status: check.failures.every((failure) => failure.writable) ? 422 : 500 };
}

/**
 * The reasons the API would refuse a request body (sent as JSON), or none:
 * its errors, or `(body): server_error` for a 500 raised before any.
 */
export function apiRefusals(body: unknown): string[] {
  const verdict = apiVerdict(body);
  return verdict.accepted || verdict.errors.length > 0 ? verdict.errors : ['(body): server_error'];
}

function validate(body: unknown): Check {
  // The API sees the JSON text: undefined fields are left out
  const request: unknown = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
  const check = new Check();
  const properties = SCHEMA.properties!;
  // FastAPI reads an empty body, and null, as no body
  if (request === undefined || request === null) {
    check.fail('', 'missing', request);
    return check;
  }
  if (!isObject(request)) {
    check.fail('', 'model_attributes_type', request);
    return check;
  }
  const field = (key: string) => (Object.hasOwn(request, key) ? check.value(properties[key], request[key], key) : undefined);

  // HouseholdImpactRequest's validators, from api.py: _policy_year,
  // _known_measures and _salary_year check one field each once it is
  // valid, and _salary_not_after_year the whole body once every field is
  const year = Object.hasOwn(request, 'year') ? field('year') : check.fail('year', 'missing', request);
  if (year !== FAILED && !POLICY_YEARS.includes(year as number)) check.fail('year', 'value_error', year);
  const policies = field('policies');
  if (Array.isArray(policies)) {
    const unknown = policies.filter((id) => !MEASURE_IDS.includes(id as string));
    // Its message names them
    if (unknown.some(holdsLoneSurrogate)) throw new Unreported();
    if (unknown.length > 0) check.fail('policies', 'value_error', policies);
  }
  // pydantic does not validate a default, so _salary_year sees only a
  // household that was sent
  const householdDefaults = definition(properties.household.$ref!).properties!;
  const sent = Object.hasOwn(request, 'household');
  const household = sent ? field('household') : { salary_year: householdDefaults.salary_year.default };
  if (sent && household !== FAILED) {
    const salaryYear = (household as { salary_year: number }).salary_year;
    if (!POLICY_YEARS.includes(salaryYear)) check.fail('household', 'value_error', household);
  }
  field('include');
  if (check.keys(request, '', 0)) return check;
  for (const key of Object.keys(request)) {
    if (!Object.hasOwn(properties, key)) check.fail(key, 'extra_forbidden', request[key]);
  }

  if (check.failures.length === 0) {
    const salaryYear = (household as { salary_year: number }).salary_year;
    if (salaryYear > (year as number)) check.fail('', 'value_error', request);
  }
  return check;
}
