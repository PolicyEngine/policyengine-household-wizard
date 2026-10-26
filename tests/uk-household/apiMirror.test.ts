import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import households from '../fixtures/uk/dashboard-households.json' with { type: 'json' };
import {
  API,
  MIRRORED_FEATURES,
  MIRRORED_VALIDATORS,
  REVIEWED_DASHBOARD_CODE,
  REVIEWED_DASHBOARD_ENVIRONMENT,
  REVIEWED_DASHBOARD_FILES,
  apiRefusals,
  apiVerdict,
  type ApiCase,
} from './reference/householdImpactApi';

/**
 * A differential test: reference/householdImpactApi.ts against the
 * dashboard's own app, which capture_household_impact_api.py runs at a
 * commit and posts each case. The mirror must give every captured case the
 * API's verdict, errors and status, so the tests that lean on it (requests
 * the package builds are ones the API accepts) say what the API does.
 */

const REQUESTS: Record<string, unknown> = Object.fromEntries(
  households.fixtures.map((fixture) => [fixture.name, fixture.request]),
);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Set a key as JSON.parse does, so a "__proto__" key is a key, not the prototype
const put = (target: object, key: string | number, value: unknown) =>
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });

function bodyFor(apiCase: ApiCase): unknown {
  if ('body' in apiCase) return clone(apiCase.body);
  if (apiCase.fixture) return clone(REQUESTS[apiCase.fixture]);
  const body = clone(API.base);
  const parentOf = (path: Array<string | number>) =>
    path.slice(0, -1).reduce<Record<string | number, unknown>>((target, key) => target[key] as Record<string, unknown>, body);
  for (const [path, value] of apiCase.set ?? []) put(parentOf(path), path.at(-1)!, clone(value));
  for (const path of apiCase.remove ?? []) delete parentOf(path)[path.at(-1)!];
  return body;
}

// The keys whose values differ between two records
const differing = (reviewed: Record<string, unknown>, captured: Record<string, unknown>) =>
  [...new Set([...Object.keys(reviewed), ...Object.keys(captured)])].filter((key) => reviewed[key] !== captured[key]).sort();

describe('the household impact API mirror', () => {
  it('is captured from the dashboard’s models, with cases on both sides', () => {
    expect(API.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(API.cases.length).toBeGreaterThan(3000);
    expect(API.cases.filter((apiCase) => apiCase.accepted).length).toBeGreaterThan(500);
    expect(API.cases.filter((apiCase) => !apiCase.accepted).length).toBeGreaterThan(1500);
    expect(apiRefusals(API.base)).toEqual([]);
  });

  it('gives every captured case the API’s verdict, errors and status', () => {
    const disagreements = API.cases.flatMap((apiCase) => {
      const api = {
        accepted: apiCase.accepted,
        errors: apiCase.errors,
        status: apiCase.status ?? (apiCase.accepted ? 200 : 422),
      };
      const mirror = apiVerdict(bodyFor(apiCase));
      return JSON.stringify(mirror) === JSON.stringify(api) ? [] : [{ name: apiCase.name, api, mirror }];
    });
    expect(disagreements).toEqual([]);
  });

  it('refuses with a reason whatever the API refuses', () => {
    for (const apiCase of API.cases) expect(apiRefusals(bodyFor(apiCase)).length === 0).toBe(apiCase.accepted);
  });

  it('answers with a 500 only where the body holds an unpaired surrogate', () => {
    const answered = API.cases.filter((apiCase) => apiCase.status === 500);
    expect(answered.length).toBeGreaterThan(50);
    // JSON.stringify escapes a surrogate only when it is unpaired
    for (const apiCase of answered) expect(JSON.stringify(bodyFor(apiCase))).toMatch(/\\ud[89a-f]/);
  });

  it('copies the validators the dashboard’s request model has now', () => {
    expect(API.validators).toEqual(MIRRORED_VALIDATORS);
  });

  it('has read all the dashboard code that runs while the API answers', () => {
    const sha256 = (code: string) => createHash('sha256').update(code, 'utf8').digest('hex');
    const ran = Object.fromEntries(Object.entries(API.code).map(([name, code]) => [name, sha256(code)]));
    const changed = differing(REVIEWED_DASHBOARD_CODE, ran);
    expect(ran, `Read the code the fixture records for ${changed.join(', ')}`).toEqual(REVIEWED_DASHBOARD_CODE);
  });

  it('has read every file of the dashboard’s the API loads or opens', () => {
    const { commit, files } = REVIEWED_DASHBOARD_FILES;
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    const changed = differing(files, API.files);
    expect(API.files, `Read git diff ${commit} ${API.source.commit} -- ${changed.join(' ')}`).toEqual(files);
  });

  it('has read the environment the API runs in', () => {
    const { commit, ...reviewed } = REVIEWED_DASHBOARD_ENVIRONMENT;
    const captured = API.environment;
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    // Each package whose version or files differ, then whatever else differs
    const packages = [...differing(reviewed.packages, captured.packages), ...differing(reviewed.contents, captured.contents)];
    const changed = [...new Set(packages)].sort();
    for (const key of ['python', 'platform'] as const) {
      if (captured[key] !== reviewed[key]) changed.push(captured[key]);
    }
    changed.push(...differing(reviewed.flags, captured.flags).map((flag) => `sys.flags.${flag}`));
    changed.push(...differing(reviewed.xoptions, captured.xoptions).map((option) => `-X ${option}`));
    for (const key of ['warnoptions', 'entry_points'] as const) {
      if (JSON.stringify(captured[key]) !== JSON.stringify(reviewed[key])) changed.push(key);
    }
    changed.push(...differing(reviewed.shims, captured.shims));
    const diff = `git diff ${commit} ${API.source.commit} -- ${Object.keys(reviewed.inputs).join(' ')}`;
    const read = changed.length ? `what changed in ${changed.join(', ')}, and ${diff}` : diff;
    expect(captured, `Read ${read}`).toEqual(reviewed);
  });

  it('implements every pydantic feature the models use', () => {
    expect(API.features.filter((feature) => !MIRRORED_FEATURES.includes(feature))).toEqual([]);
  });

  it('reads the choices the dashboard’s request models name', () => {
    const { choices } = API;
    expect(choices.policy_years).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
    expect(choices.salary_year).toBe(2026);
    expect(choices.oldest_child_age).toBe(19);
    expect(choices.measure_ids).toHaveLength(9);
    expect(choices.brmas.length).toBeGreaterThan(100);
    expect(choices.local_authorities.length).toBeGreaterThan(300);
  });
});
