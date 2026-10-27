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
 * changes (`REVIEWED_DASHBOARD_CODE`), any file of the dashboard's the API
 * loads or opens through Python (`REVIEWED_DASHBOARD_FILES`), or the
 * environment it runs in (`REVIEWED_DASHBOARD_ENVIRONMENT`), until it is
 * read again.
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
    seed: number;
  };
  /**
   * What the API ran in: the interpreter, its flags and options, the
   * platform, the version of each package installed and a digest of its
   * files, the project's entry points, the sha256 of uv's shim, and that of
   * the commit's files that decide the rest.
   */
  environment: {
    python: string;
    flags: Record<string, number | boolean>;
    xoptions: Record<string, string | boolean>;
    warnoptions: string[];
    platform: string;
    packages: Record<string, string>;
    contents: Record<string, string>;
    entry_points: string[];
    shims: Record<string, string>;
    inputs: Record<string, string | null>;
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
   * as a module or opened through Python, by path: a Python file's code as
   * `ast.unparse` gives it without docstrings, another file's bytes.
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
 * at bd346f30 and unchanged at 5ee4e23e. Apart from FastAPI's validation,
 * which this mirror follows, that code refuses only a malformed `definition`
 * query (a 400), which the package never sends. The rest checks the request
 * again from its own JSON, builds the answers, picks the measures and the
 * workers, times the calculation, keeps answers by request, and stops the
 * workers at shutdown.
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
 * opens through Python (`API.files`), as read at the commit below: 31
 * Python modules and budget_years.json. At import they:
 * - build the app, its middleware and routes, the models, the reform list
 *   and the data tables, and hash the data and model limit registries;
 * - read budget_years.json, and the environment for the worker, request and
 *   calculation time limits;
 * - check what the installed policyengine-uk has (whether
 *   `read_parameter_changes` takes calendar years, and the years its UC
 *   rebalancing runs);
 * - make the pipeline's `rich` console, and call policyengine's recorder of
 *   the versions loaded.
 *
 * None of it changes pydantic, pydantic-core, FastAPI or Starlette. A change
 * to any of these files, a new one, or one no longer loaded makes
 * apiMirror.test.ts fail: read `git diff <commit> <the new commit> -- <the
 * files>` in the dashboard (the failure gives the command), follow in this
 * mirror anything that changes what the API refuses before the calculation,
 * then record the new commit and hashes here.
 */
export const REVIEWED_DASHBOARD_FILES: { commit: string; files: Record<string, string> } = {
  commit: '5ee4e23ed8e11d2c7cff3b837ed7902f4a138de1',
  files: {
    'src/uk_budget_data/__init__.py': '12a819e71709b113828c6354c5ed4b8c946a3be6c08d85ffa1012b8bc3673807',
    'src/uk_budget_data/api.py': 'a5c0433f62ccce96081f6974ec41e02f4d98586e494de394e69b003d0da53a42',
    'src/uk_budget_data/budget_measures/__init__.py': 'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1',
    'src/uk_budget_data/budget_measures/connect_student_loan_repayments.py': 'cc91e585d308001c8e7a902d0a621cce142b39b67b979236389e0fb68a8ec4e2',
    'src/uk_budget_data/budget_measures/employer_ni_relief_ages_21_to_24.py': '063816a303c646ea6f1aa9127f6e45d9e9345d01bd6bba8de5516a8c7b3a5db2',
    'src/uk_budget_data/budget_measures/pump_vat_on_fuel_duty_deferral.py': '36a670dc921d4426951b1ba7af15f593780a3fad3106044a7b88453264c62a0a',
    'src/uk_budget_data/budget_measures/road_fuel_vat_cut.py': 'f50f794036f796d0d543354b221fda147dc1e9f8a0ab57bbbb96c5179f976c4b',
    'src/uk_budget_data/budget_measures/state_pension_income_tax_allowance.py': '11a23d0325e44707502c42d5e7a854b528d865a678ae42ea311393fd1495bdee',
    'src/uk_budget_data/budget_measures/warm_home_discount_top_up.py': 'a9ce3d9d5428bc8190160864839fac8e668e57ad9ecc44ceec13a0362f027f47',
    'src/uk_budget_data/budget_measures/zero_vat_on_domestic_electricity.py': '4e797e1451cbcf1f5d3fd56198e8a058c290ef67e03f50a2a29d754226c00115',
    'src/uk_budget_data/budget_years.json': '8f03e13e0cbb80c286625a7773a717c285d4aae1420055825c3a0106a7c87823',
    'src/uk_budget_data/budget_years.py': '787128ae63dd872ecfcaf02210141492e394f74973b70f63438a94e2d8c4c5fb',
    'src/uk_budget_data/calculators.py': 'f1ad77647ecc3588cb1b29d2305bf721ffb3b9073326860b33e7cb0b858e8aa9',
    'src/uk_budget_data/certified_data.py': '8fa8d7ffac7ea14402474026ae518bf0b11a2f5361b2af3cf06bc9bc9f07e7f3',
    'src/uk_budget_data/data_limits.py': 'e5ba0998e2e0369f53a7a66f4a743d53d3a3fc3e12ae59858b1f75e73d20ed93',
    'src/uk_budget_data/definitions.py': '8ce794cc07bcbed14851ef535da2bc3e7476b64e9966d9a919ddeaba14ac8ddc',
    'src/uk_budget_data/household_impact.py': '3fea979bc4c7ba260c92a62b6fb249f4d11048ce881ec0be865de5bf10bfa8a6',
    'src/uk_budget_data/measure_templates.py': 'af8c09419d664a8ef08491a5ecdea047523b55f0d8d871fc5bbfe54997539421',
    'src/uk_budget_data/model_limits.py': '4c0a8ac198b5592d952f228ee6ca79aa31ac77c7819357be9d3b163c6a884013',
    'src/uk_budget_data/models.py': '093c55bb28182a0da865681f92c2c5f52249c2346c12dc9361da6e6698d5bed0',
    'src/uk_budget_data/personal_impact.py': '35818e981dda71520e23bac6f244d5997d7d7f7ca3e1006925e101e63e6dbc47',
    'src/uk_budget_data/pipeline.py': '033a66a29afe98cdef8852c3fd3eebffa4ae38ce4971ef9aa48cd0e8a17503ff',
    'src/uk_budget_data/private_outputs.py': 'f169e8673edc11904d3fc5ef468f0e3ba8edb48904b1ee5fdea59e61b257389a',
    'src/uk_budget_data/publication/__init__.py': 'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1',
    'src/uk_budget_data/publication/artifacts.py': 'cec2ef638efb74640243bec4574178da585af1609416c65c85f80c3c2a3939f9',
    'src/uk_budget_data/publication/combine.py': 'e75fec0b44e467ef0532bf25e2d7880adf480d4ea556273aa0748d612bdb6b4e',
    'src/uk_budget_data/publication/receipt.py': '4687a754857a7a209f4008ab7ad38410e1b3017c1c6bab22a6452874380e45a5',
    'src/uk_budget_data/publication/tables.py': '7fcfb924582ea222fcc3668aabddaf7c8839c10dc20111feab0de26d81dc621a',
    'src/uk_budget_data/publication/template_proof.py': '26e562365009cddce62330b7956fabe65360841f7b4ea2c36622ae4c4d2a8a3a',
    'src/uk_budget_data/reforms.py': '910b90c0b5777773d6a6c25539dc2dac9f3117c59a499be67f64ecf3676af94b',
    'src/uk_budget_data/runtime_identity.py': 'dfd5e5438166dbf3baeb791e7ef0d5db8eb778508d432519def683c1de96a769',
    'src/uk_budget_data/scored_years.py': 'b37938878a2e18e13b75d59f2fe0a8386cc6bc2c4b34b5b377c0866654c2e6fe',
  },
};

/**
 * The environment the capture ran the dashboard's API in
 * (`API.environment`), as read at the commit below: the interpreter, its
 * flags and `-X` and `-W` options, and the platform; the version of each
 * package installed from the dashboard's uv.lock (the lock takes each from
 * PyPI), and a sha256 of its files in site-packages, each checked against
 * its RECORD, so a file changed along with its RECORD still changes it; the
 * entry points of the dashboard's own install; the sha256 of the shim uv
 * adds; and that of the commit's .python-version, pyproject.toml and
 * uv.lock, which decide the rest. Starlette parses the body with the
 * interpreter's `json.loads`, then pydantic validates it with
 * pydantic-core, typing-inspection (which reads the `Literal` choices) and
 * annotated-types (the bounds); this mirror follows them as installed here.
 * When a recapture runs in anything else, apiMirror.test.ts fails: read
 * what changed in each package whose version or files differ (and in the
 * interpreter and its settings), and `git diff <commit> <the new commit> --
 * .python-version pyproject.toml uv.lock` in the dashboard, follow in this
 * mirror anything that changes what the API refuses before the
 * calculation, then record the new commit and environment here.
 */
export const REVIEWED_DASHBOARD_ENVIRONMENT: { commit: string } & ApiCapture['environment'] = {
  commit: '5ee4e23ed8e11d2c7cff3b837ed7902f4a138de1',
  python: 'cpython 3.13.9',
  flags: {
    debug: 0,
    inspect: 0,
    interactive: 0,
    optimize: 0,
    dont_write_bytecode: 1,
    no_user_site: 0,
    no_site: 0,
    ignore_environment: 0,
    verbose: 0,
    bytes_warning: 0,
    quiet: 0,
    hash_randomization: 1,
    isolated: 0,
    dev_mode: false,
    utf8_mode: 1,
    warn_default_encoding: 0,
    safe_path: false,
    int_max_str_digits: 4300,
  },
  xoptions: {
    utf8: true,
  },
  warnoptions: [],
  platform: 'macosx-11.0-arm64',
  packages: {
    'annotated-doc': '0.0.4',
    'annotated-types': '0.7.0',
    anyio: '4.11.0',
    asttokens: '3.0.1',
    attrs: '26.1.0',
    blosc2: '3.11.1',
    certifi: '2026.10.19',
    'charset-normalizer': '3.4.4',
    click: '8.3.1',
    decorator: '5.2.1',
    defusedxml: '0.7.1',
    dpath: '2.2.0',
    'et-xmlfile': '2.0.0',
    executing: '2.2.1',
    fastapi: '0.122.0',
    filelock: '3.20.0',
    fsspec: '2025.10.0',
    h11: '0.16.0',
    h5py: '3.15.1',
    'hf-xet': '1.7.0',
    httpcore: '1.0.9',
    httptools: '0.7.1',
    httpx: '0.28.1',
    'huggingface-hub': '1.1.5',
    idna: '3.11',
    iniconfig: '2.3.0',
    ipython: '8.37.0',
    jedi: '0.19.2',
    jinja2: '3.1.6',
    jsonpickle: '4.1.1',
    jsonschema: '4.26.0',
    'jsonschema-specifications': '2025.9.1',
    'markdown-it-py': '4.0.0',
    markupsafe: '3.0.3',
    'matplotlib-inline': '0.2.1',
    mdurl: '0.1.2',
    'microdf-python': '1.3.10',
    msgpack: '1.1.2',
    ndindex: '1.10.1',
    networkx: '3.6',
    numexpr: '2.14.1',
    numpy: '2.1.3',
    odfpy: '1.4.1',
    openpyxl: '3.1.5',
    packaging: '25.0',
    pandas: '2.3.3',
    parso: '0.8.5',
    pexpect: '4.9.0',
    platformdirs: '4.5.0',
    plotly: '5.24.1',
    pluggy: '1.6.0',
    policyengine: '6.10.2',
    'policyengine-core': '3.33.3',
    'policyengine-uk': '2.132.6',
    'prompt-toolkit': '3.0.52',
    psutil: '6.1.1',
    ptyprocess: '0.7.0',
    'pure-eval': '0.2.3',
    'py-cpuinfo': '9.0.0',
    pydantic: '2.12.5',
    'pydantic-core': '2.41.5',
    pygments: '2.19.2',
    pytest: '8.4.2',
    'python-dateutil': '2.9.0.post0',
    'python-dotenv': '1.2.1',
    pytz: '2025.2',
    pyvis: '0.3.2',
    pyyaml: '6.0.3',
    referencing: '0.37.0',
    requests: '2.32.5',
    rich: '14.2.0',
    'rpds-py': '2026.6.3',
    shellingham: '1.5.4',
    six: '1.17.0',
    sniffio: '1.3.1',
    sortedcontainers: '2.4.0',
    'stack-data': '0.6.3',
    'standard-imghdr': '3.13.0',
    starlette: '0.50.0',
    tables: '3.10.2',
    tenacity: '9.1.2',
    tqdm: '4.67.1',
    traitlets: '5.14.3',
    'typer-slim': '0.20.0',
    'typing-extensions': '4.15.0',
    'typing-inspection': '0.4.2',
    tzdata: '2025.2',
    urllib3: '2.5.0',
    uvicorn: '0.38.0',
    uvloop: '0.22.1',
    watchfiles: '1.1.1',
    wcwidth: '0.2.14',
    websockets: '15.0.1',
    wheel: '0.45.1',
  },
  contents: {
    'annotated-doc': '69835968a6745b29607304c2d950ea165707a0d566d618ef6f9ee23a6e30d0ab',
    'annotated-types': '2beda01b145e7cfdd336f72f35075a1386f5676438a1a9eb9b103d57289f58f5',
    anyio: '7c170c8b76635e7b22292f8cb00fae1ddbb98379f0bc62e36dd8459d3273a22b',
    asttokens: '04f2a2f2d7095e659292f54e11d37bcdd00c95b4306712b6013ce420cf33cb33',
    attrs: 'd23dbaac4c1a0ce76c9d5de469e8ca1a52cd4faedad5837adbfc4ec93ec5041e',
    blosc2: 'daa27dbb9559270ea664a338443f12a5bc39d4887d9dc590d1f66c86c4d2ae52',
    certifi: '13ed91ff9fb31feb66d32a944601d7d6645fe2d934cd0adaf6eefe770f329239',
    'charset-normalizer': '9211a1e230eb54ad6d372d20e28f65d3d533ad59c152ff817f1eec001e1a71c2',
    click: 'a56e3076d9d58abc53dfa6fbf58192bb6ae0c2f5b7529479ce49bb0860dcadaa',
    decorator: 'f7fd8d022a7ae0a6584e6dbde53f4fa113cf16cb4ca8f6c75d25b8bccfdef7e5',
    defusedxml: 'caf41763a8e7276a4d7495e1fc8657e356f80737c68fb9e8fd96ffe6defe27fc',
    dpath: '863fcf5f0a137a6b225a9b6483fc7c6c15f29536b6ecc5ae57734ca3015fb84f',
    'et-xmlfile': '044d045cd96f62c45ff307898da55c88e367d45e228d1d881f85176531674c36',
    executing: '79f74d708f63ad8d90f4dbc501afc8741ea5fb385bfeb26397270d27a604d3b8',
    fastapi: '1e1d5db78556adb7e9e22551ef9e5c8194a78da7ab0932bb69bc5b9f2cbfdf26',
    filelock: '8f5eeb940497b157cc63396a72f9cfaf1278c778fceca8f6956c14a667d577fe',
    fsspec: 'ecf87d169994b56e8173b5e85dc92de508a673f5500e2fd85b262c55e8b4f7a3',
    h11: 'eaaa57858a716fe57f0292d70be32d925260b604bbf11332bb74e3355ea85e3f',
    h5py: 'e4cfe8403fb620f287ad72d3c69c7afb7c8c5f3768c8435c6db6b588a89cbf63',
    'hf-xet': 'de0a0d73453c0d65ed99a6e8f1e1b661f5942dfe0ba949162c807464a2a1fcf5',
    httpcore: '1767e1960cc6881c9f125906e825bdc667976335fcc09770a341c94516cfb1c9',
    httptools: '48d6e9a4364a69ef94bfca4aa6f1c918617e89024da8e9910cf90c5ba75e094b',
    httpx: 'd8a686bd04c555a246e6675336eadfd7dca2f791cfd5132a055618ff7722fe95',
    'huggingface-hub': '13076d8733aa4eef647a7998e79879fb3ce03f35070bf394b40db6b2ba8eb9cc',
    idna: '6a52764f9be3c304ef9630e0cc50da7c85eb8b703bf37abc1d8ff0bdd0c5d221',
    iniconfig: '40371b4738a14ad509568a6635138e2fc5c88fde7d415d9872bb102c6de47487',
    ipython: '7df0ed5baf2d386eebeb1218060389320bc32b06cb141354ae44eba1ddb781b5',
    jedi: '6f12c93086e138cb4461b226d44bf32ebe27a1aaa51c218e302b32bcd92ff3fe',
    jinja2: '27afdd8532b6b40d4d9d7b2386c42e22bacd34e695fedee73ff4885f58769f65',
    jsonpickle: '23cebf0b3fb38dc7f573ceaaf7ed48a5a059317e0d862620913b49eeadc77ef0',
    jsonschema: '17b77f6ecd682a49854409bf19c9f329b312039e78ce33e65fcfd66a8d71873a',
    'jsonschema-specifications': 'fda205d1bd71e9328358ef0108b6b601da655054ebd106047c72850e0d8c5681',
    'markdown-it-py': '732d1f8d96c4e86a11ec141bdafcf2b5058f6329e9f4db1af4225f03cfdf51f4',
    markupsafe: '30d8fdb7823358da3218e1159af50083fe9c6e72ff7f7560ed80349a6700a155',
    'matplotlib-inline': '2be14a26375af3ffb9816e94e8679c1f1e0f343bcee9108ac5705678afa316d9',
    mdurl: '74951c65036f75d4ba2f339b788847d5a0020eb1b6adb3df7e5608a3a2b28098',
    'microdf-python': 'dc43d87e2e5a9583f1ab74c65257a6410e7a20bca81e959294b041927447d302',
    msgpack: '4fe996e44ee2fb7f23b17b74c962f0d6380d7358a7a741a54cd9091c97584274',
    ndindex: '0acb439a5ca10ae64a7d01efaea435dcb287aa73e1da3c4eacaf87bfdf65b3d7',
    networkx: '5fa1c0a48e446373d9e6efc82f8f246dcb752ee7e7246a4552d78f32e7a18cc3',
    numexpr: '6f9719a750651f89f670fda450252fde6a3d808e6cde8aadc83899868807c7e4',
    numpy: '7d16bb2418f70d3abc92f079bc00e2386e615ca5fdae37d054e87e37330f3083',
    odfpy: '89a4bcc52864f03ef86f605b222bd9fabb348d4251ccb3cea092fd448ce191de',
    openpyxl: 'ba39676853abe49bacad1a4186e20b42e50a5117ad5a85316c9f79d3ed6bf032',
    packaging: 'e3a43abfa82a74f5127b5cad4eaaa1c34c353c720e3d8db603a87e331792b8c7',
    pandas: 'b853738c1e32925c08f9e9ca27527b5a92117dcd687833cf5fe8d53928f1c15f',
    parso: '1bc1830ebdce96c4f0bc07216a1644c977a1b80fe5f11d368b95c5b2595cf899',
    pexpect: 'c9168eabbdf937525885c4524a6094fbbd8286f3aadeb8671f914a3975f51849',
    platformdirs: 'ae92695f6ab09a4569aca77a2c97da5124c695d783db2c999c7728848bfc6714',
    plotly: 'ff1fabe0af496b9af919e204cb76d92cd71e76d81991eb45ebdfe3507d1772d5',
    pluggy: 'aa3ca0397e96868be537d235fde1a9d1ad933940e22cbb26999351d8f54f03e6',
    policyengine: '2427dafe9b62bf7e73604615a23e5e80bbd52fd4785574ad606b23570133987c',
    'policyengine-core': '14cd89a0b9c4f02fe3dbaaa636cd9bb7bb29a453c54af1f61efdcacbc0d28328',
    'policyengine-uk': '53dcdbfd9e6e066b8be6b4e7c990c2891d2f3d57f58ec6e7dc804c0cac83debd',
    'prompt-toolkit': '9a066ade080fdaf6fb65330ed492115f85ce79445a1c1e97be35d7c21df49511',
    psutil: '47544e4d0ddf18643d8a78a0e8eeb7c3a6a7239d2c3eaa2080a6904ebdb578dd',
    ptyprocess: '354387d7500e877c47c54403b231a7b689d6d4a6c6558b0ca39f3d569f770388',
    'pure-eval': '21eb9d65d83203d683470f5f5b1bbfb4fbddc504dbe79b4e197cbd932b541263',
    'py-cpuinfo': '07ee00ab9a93b1a1eee40fe82fab7c1734ad58790178a6b70dbdb6ea9d1dcaea',
    pydantic: 'e1fed0290ffaa0664a5837e54497a3107844cc78b1c35db0360198a68953403a',
    'pydantic-core': '32711bd17ecc9565833add2eb4a2e9fd6b38ea09e5d1d92a0bfa40283b202e31',
    pygments: 'a0bc8170c914bd371d33068ca7c6918cdfb0b2022a5e0e6d0c9b4a8b43546095',
    pytest: '8ac21f3ef8d6fae81a8eaf222ef573175bc34bbc445f10da5642002f65836419',
    'python-dateutil': '8d9a048a30d193383666fb26b456cb20a228da1c2cb75d1863f1462f9f0af8eb',
    'python-dotenv': '01bf6c77d3e400fe3ca95f29dc6321cd3e88e0a7dafbda2f75c0d6e12c60d833',
    pytz: 'a4dba02940c86f4963d65cf78ed276180ba0485ccee4861ad9583a67ce66b911',
    pyvis: '992a06feca0cd7b3260c09a68d93638c2c73fae1911421c58a72042382e40272',
    pyyaml: 'b28b755342b2d8e27e112967ea525345a1ddecc25390f40a6bcdc0c089dc19ac',
    referencing: '0d218a14c4428adaef3c56bc09cf0b531399c591931128f3e8d67ecd99a85b03',
    requests: '058a013fd886d27dff2050e745b584c6647aaac64700fcb69b4f7081af7b7225',
    rich: 'cad31d901d25e60c4bf0bfe7f77e5b65e771795799a548b8d67a577292549118',
    'rpds-py': '35fd65f406c6cfc37409d4e2a6fa079b9303d8c2b6d1080862b98a08b3807594',
    shellingham: 'de44fcb893faacaa98ea35fa21357dd04637ebbb159576951a7478f215700868',
    six: 'c552d50665c713574c5af3a21723724699ffbac6417bd5a1e0d7204826c35c07',
    sniffio: 'a5014d3c2ec104c3b9777467af292652ae6c1677819acedda3ba7689ac0f3e87',
    sortedcontainers: '02966ddd5afd9703e874ec4bf5604798b85a4e92da2a1f8c453979e504157731',
    'stack-data': 'f0633e70d49e44ed0a71dbe7a8bdc53a2a827a673677ac3f9eb89c1347f68a91',
    'standard-imghdr': 'db80ff949dfc6a9571c1f48b7ef1325ee3f5304ae7e9512dfc425fd60e7c235f',
    starlette: '573e476c65e9f09004b1e8830fe3d2b17953c50cfd647e2e5df2a1a37ec8ba72',
    tables: '9f2c966456cc4dc4a08e4968a4fd9d31504d9d9efe679ceb3a5bd9b0040a5c68',
    tenacity: '5ab82699cdd2a5ab2f9064a63b7e09faa7150e12c7fd75e464378aae49262982',
    tqdm: '98671736fffe2ea921781530d5feb88588582b0530aeb6d25b001c357f1e1015',
    traitlets: '7bef05392eadf7be51dd6f6075b282c62f3203700d02de4e88f6ee308ea29e83',
    'typer-slim': 'c50e458e8c268973a654535d693e5ed2a307071e9ad19dbc4ec225c8a075db38',
    'typing-extensions': '6f494844e2804ce27c4e181f4c3120b1d8a597f75a65a6e53dd9a2aa4cc0999d',
    'typing-inspection': '8dcd15bb0b1d4f19dac98d3ea2449b7f4c932f3859ec42609cbc49b230d788c6',
    tzdata: '2246ae1ee7020f91589aee4ce6bf18d716d13f71ed84dfe9512d0c71032c40f6',
    urllib3: '9ae60f0082f4bbaf484d063aa372ce846f6551544ed50b58af65ecd9af45d869',
    uvicorn: '0d025962f7f68eab99e2673e5e08937ebfff04afbf162c0dbb525ace7b8062a6',
    uvloop: 'bd0b5e878321a82c3c43d8c4b6348221abeaf19b25bc4f06226ae3bb7aff6ac1',
    watchfiles: '272535e2c37d2a87e03ec2e8e0db982819b1396dd4d42dcb77144130a6a075f6',
    wcwidth: '2dd5f5e92639fad618bacc50f6a249ec45083f3c064f203133e7a96a4fc09a44',
    websockets: '179a800e1bcf2b43dbcfb121ecaf726fff2e073c6ffb86e48bb9fdd065570530',
    wheel: '8dfe61906444ac78283e402de6d2b566b76028491a8188acbd15eca1d37420b1',
  },
  entry_points: [
    'console_scripts: uk-budget-api = uk_budget_data.api:main',
    'console_scripts: uk-budget-data = uk_budget_data.cli:main',
  ],
  shims: {
    '_virtualenv.pth': '69ac3d8f27e679c81b94ab30b3b56e9cd138219b1ba94a1fa3606d5a76a1433d',
    '_virtualenv.py': '6cf30c56faf2a55228914dbbd17f8088ed371ebb08f5e7fa6fd931f913fcaf1d',
  },
  inputs: {
    '.python-version': '02e735b3dfe1c32833eb550b7ff8ffa17f5f2bc3fa1e7bae61a8f5a3883ce398',
    'pyproject.toml': '82606c94c61336e874b8388d7c897587892ec9ba7e2dcea28ee44292ba4b91eb',
    'uv.lock': '8811b89ac843dbe7335abb1ea3cb3e737c61f5b1fa31151b4c496093e8749bdd',
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
