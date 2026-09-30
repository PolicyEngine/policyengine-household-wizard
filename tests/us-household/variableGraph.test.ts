import { describe, expect, it } from 'vitest';
import { buildVariableGraph } from '../../scripts/generate-variable-graph';

type Components = string[] | string | null;

function metadata(
  variables: Record<
    string,
    {
      entity?: string;
      isInputVariable?: boolean;
      defaultValue?: unknown;
      adds?: Components;
      subtracts?: Components;
    }
  >,
  parameters: Record<string, { values?: Record<string, unknown> }> = {},
) {
  return {
    version: '9.9.9',
    variables: Object.fromEntries(
      Object.entries(variables).map(([name, variable]) => [
        name,
        { entity: 'person', isInputVariable: !variable.adds && !variable.subtracts, ...variable },
      ]),
    ),
    parameters,
  };
}

describe('buildVariableGraph', () => {
  it('walks adds and subtracts transitively from the roots', () => {
    const graph = buildVariableGraph(
      metadata({
        total: { adds: ['b', 'a'], subtracts: ['c'] },
        a: { adds: ['leaf'] },
        b: {},
        c: {},
        leaf: {},
        unrelated: { adds: ['a'] },
      }),
      ['total'],
    );
    expect(graph.policyengineUsVersion).toBe('9.9.9');
    expect(Object.keys(graph.variables)).toEqual(['a', 'b', 'c', 'leaf', 'total']);
    expect(graph.variables.total).toEqual({
      entity: 'person',
      isInputVariable: false,
      defaultValue: null,
      adds: ['a', 'b'],
      subtracts: ['c'],
    });
    expect(graph.variables.leaf).toEqual({
      entity: 'person',
      isInputVariable: true,
      defaultValue: null,
      adds: [],
      subtracts: [],
    });
  });

  it('records whether the model computes each variable, and its default', () => {
    const graph = buildVariableGraph(
      metadata({ formula: { isInputVariable: false }, input: { defaultValue: 40 } }),
      ['formula', 'input'],
    );
    expect(graph.variables.formula.isInputVariable).toBe(false);
    expect(graph.variables.input).toMatchObject({ isInputVariable: true, defaultValue: 40 });
  });

  it('resolves a parameter path to the union of its list values over time', () => {
    const graph = buildVariableGraph(
      metadata(
        { total: { adds: 'gov.sources' }, old: {}, current: {}, both: {} },
        {
          'gov.sources': {
            values: { '2020-01-01': ['old', 'both'], '2025-01-01': ['current', 'both'] },
          },
        },
      ),
      ['total'],
    );
    expect(graph.variables.total.adds).toEqual(['both', 'current', 'old']);
    expect(Object.keys(graph.variables)).toEqual(['both', 'current', 'old', 'total']);
  });

  it('terminates on cycles', () => {
    const graph = buildVariableGraph(metadata({ a: { adds: ['b'] }, b: { adds: ['a'] } }), ['a']);
    expect(Object.keys(graph.variables)).toEqual(['a', 'b']);
  });

  it('fails loudly on missing variables, flags, and unusable parameters', () => {
    expect(() => buildVariableGraph(metadata({}), ['absent'])).toThrow(/absent/);
    expect(() =>
      buildVariableGraph(
        { version: '9.9.9', variables: { bare: { entity: 'person' } }, parameters: {} },
        ['bare'],
      ),
    ).toThrow(/isInputVariable/);
    expect(() =>
      buildVariableGraph(metadata({ total: { adds: 'gov.missing' } }), ['total']),
    ).toThrow(/gov\.missing/);
    expect(() =>
      buildVariableGraph(
        metadata(
          { total: { adds: 'gov.scalar' } },
          { 'gov.scalar': { values: { '2020-01-01': 5 } } },
        ),
        ['total'],
      ),
    ).toThrow(/non-list/);
  });
});
