"""Capture what the household impact API accepts, for the wizard's tests.

The Autumn Budget 2026 dashboard checks a ``POST /api/household-impact`` body
with three pydantic models in its ``src/uk_budget_data/api.py``
(``HouseholdChildRequest``, ``HouseholdAnswersRequest`` and
``HouseholdImpactRequest``). This script reads those classes, and the choices
they name, from git at the given commits, runs them under pydantic, and writes
``household-impact-api.json`` next to it:

- ``choices``: the regions, tenures, student loan plans, Council Tax bands,
  Broad Rental Market Areas, local authorities, parts, policy years and
  measure ids the models accept;
- ``base`` and ``cases``: a valid body, and changes to it (one field set to
  each kind of value pydantic might take or refuse, children, unknown and
  prototype keys, the year rules, random combinations of these, and the
  requests in ``dashboard-households.json``), each with pydantic's verdict:
  accepted or not, and the location of each error.

``tests/uk-household/apiMirror.test.ts`` checks that
``reference/householdImpactApi.ts`` gives every case the same verdict.

The classes are run on their own, with the choices they read from
``household_impact`` filled in, so neither policyengine-uk nor the dashboard
needs installing. Run it from the wizard's root:

    uv run --no-project --python 3.13 --with pydantic==2.12.5 \\
      tests/fixtures/uk/capture_household_impact_api.py \\
      --dashboard ~/PolicyEngine/uk-autumn-budget-dashboard-2026 \\
      --commit <dashboard commit> \\
      --policyengine-uk ~/PolicyEngine/policyengine-uk --uk-version <tag>

Use the pydantic and policyengine-uk versions the dashboard's ``uv.lock``
pins at that commit.
"""

import argparse
import ast
import copy
import json
import random
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Literal, Optional

import pydantic
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

HERE = Path(__file__).resolve().parent
OUT = HERE / "household-impact-api.json"
MODELS = ("HouseholdChildRequest", "HouseholdAnswersRequest", "HouseholdImpactRequest")
SEED = 20261025
COMBINATIONS = 400


def git_show(repo: Path, rev: str, path: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "show", f"{rev}:{path}"], check=True, capture_output=True, text=True
    ).stdout


def resolve_commit(repo: Path, rev: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", f"{rev}^{{commit}}"], check=True, capture_output=True, text=True
    ).stdout.strip()


def module_assignments(tree: ast.Module) -> dict[str, ast.expr]:
    values = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            values[node.targets[0].id] = node.value
    return values


def enum_names(uk: Path, version: str, module: str, name: str) -> tuple[str, ...]:
    """The member names of policyengine-uk's enum ``name`` in ``module``."""
    tree = ast.parse(git_show(uk, version, module.replace(".", "/") + ".py"))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == name:
            members = [
                (target.id, ast.literal_eval(statement.value))
                for statement in node.body
                if isinstance(statement, ast.Assign)
                for target in statement.targets
                if isinstance(target, ast.Name)
            ]
            # Iterating an Enum skips aliases (members sharing a value), so
            # every name is a member only while the values are distinct
            values = [value for _, value in members]
            assert len(set(values)) == len(values), f"{name} has aliases"
            return tuple(member for member, _ in members)
    raise SystemExit(f"No enum {name} in policyengine-uk's {module}")


def household_impact_choices(dashboard: Path, commit: str, uk: Path, version: str) -> SimpleNamespace:
    source = git_show(dashboard, commit, "src/uk_budget_data/household_impact.py")
    tree = ast.parse(source)
    imported = {
        alias.asname or alias.name: node.module
        for node in tree.body
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("policyengine_uk")
        for alias in node.names
    }
    assigned = module_assignments(tree)
    choices = {}
    for name in ("REGIONS", "TENURES", "OLDEST_CHILD_AGE", "SALARY_YEAR", "PARTS"):
        choices[name] = ast.literal_eval(assigned[name])
    # round(20.00 * 52): arithmetic on literals only
    electricity = assigned["ELECTRICITY_SPENDING"]
    assert ast.unparse(electricity) == "round(20.0 * 52)", ast.unparse(electricity)
    choices["ELECTRICITY_SPENDING"] = round(20.00 * 52)
    # Each is `tuple(member.name for member in <policyengine-uk enum>)`
    for name in ("STUDENT_LOAN_PLANS", "BRMAS", "LOCAL_AUTHORITIES", "COUNCIL_TAX_BANDS"):
        value = assigned[name]
        assert isinstance(value, ast.Call) and ast.unparse(value.func) == "tuple", ast.unparse(value)
        generator = value.args[0]
        assert isinstance(generator, ast.GeneratorExp), ast.unparse(value)
        assert ast.unparse(generator.elt) == f"{generator.generators[0].target.id}.name", ast.unparse(value)
        enum = generator.generators[0].iter.id
        choices[name] = enum_names(uk, version, imported[enum], enum)
    return SimpleNamespace(**choices)


def function_source(tree: ast.Module, name: str) -> str:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.unparse(node)
    raise SystemExit(f"No function {name}")


# The code the choices are read through, as `ast.unparse` gives it: the
# capture stops if any of it changes, since the reading would then be wrong
WIRING = {
    "household_impact.measure_ids returns": (
        "return [reform.id for reform in get_autumn_budget_2026_reforms() "
        "if reform.id != AUTUMN_BUDGET_2026_COMBINED_ID]"
    ),
    "reforms.get_autumn_budget_2026_reforms returns": "return _get_autumn_budget_2026_reforms()",
    "reforms._get_autumn_budget_2026_reforms builds": "members = [factory() for factory in _MEASURE_FACTORIES]",
    "budget_years._CONFIG": "_CONFIG = json.loads(files('uk_budget_data').joinpath('budget_years.json').read_text())",
    "budget_years.POLICY_YEARS": "POLICY_YEARS = _CONFIG['policy_years']",
    "api.py imports POLICY_YEARS": "uk_budget_data.budget_years.POLICY_YEARS",
    "api.py imports household_impact": "uk_budget_data.household_impact",
}


def check_wiring(dashboard: Path, commit: str):
    impact = ast.parse(git_show(dashboard, commit, "src/uk_budget_data/household_impact.py"))
    reforms = ast.parse(git_show(dashboard, commit, "src/uk_budget_data/reforms.py"))
    years = ast.parse(git_show(dashboard, commit, "src/uk_budget_data/budget_years.py"))
    api = ast.parse(git_show(dashboard, commit, "src/uk_budget_data/api.py"))
    found = {
        "household_impact.measure_ids returns": function_source(impact, "measure_ids").splitlines()[-1].strip(),
        "reforms.get_autumn_budget_2026_reforms returns": function_source(
            reforms, "get_autumn_budget_2026_reforms"
        ).splitlines()[-1].strip(),
        "reforms._get_autumn_budget_2026_reforms builds": next(
            line.strip()
            for line in function_source(reforms, "_get_autumn_budget_2026_reforms").splitlines()
            if "_MEASURE_FACTORIES" in line
        ),
        "budget_years._CONFIG": ast.unparse(module_statement(years, "_CONFIG")),
        "budget_years.POLICY_YEARS": ast.unparse(module_statement(years, "POLICY_YEARS")),
    }
    # What api.py's own names POLICY_YEARS and household_impact are bound to
    imported = {
        alias.asname or alias.name: f"{node.module}.{alias.name}"
        for node in api.body
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }
    found["api.py imports POLICY_YEARS"] = imported.get("POLICY_YEARS")
    found["api.py imports household_impact"] = imported.get("household_impact")
    for name, expected in WIRING.items():
        assert found[name] == expected, f"{name} changed: {found[name]!r}"


def module_statement(tree: ast.Module, name: str) -> ast.stmt:
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return node
    raise SystemExit(f"No assignment to {name}")


def measure_ids(dashboard: Path, commit: str) -> list[str]:
    """The ids of ``_MEASURE_FACTORIES``' reforms, in order: what
    ``household_impact.measure_ids()`` returns (every single measure)."""
    tree = ast.parse(git_show(dashboard, commit, "src/uk_budget_data/reforms.py"))
    assigned = module_assignments(tree)
    constants = {
        name: value.value
        for name, value in assigned.items()
        if isinstance(value, ast.Constant) and isinstance(value.value, str)
    }
    factories = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
    ids = []
    for factory in assigned["_MEASURE_FACTORIES"].elts:
        reform_ids = [
            keyword.value
            for node in ast.walk(factories[factory.id])
            if isinstance(node, ast.Call)
            for keyword in node.keywords
            if keyword.arg == "id"
        ]
        assert len(reform_ids) == 1, factory.id
        value = reform_ids[0]
        ids.append(constants[value.id] if isinstance(value, ast.Name) else ast.literal_eval(value))
    return ids


def request_models(dashboard: Path, commit: str, household_impact: SimpleNamespace, policy_years: list[int]):
    source = git_show(dashboard, commit, "src/uk_budget_data/api.py")
    tree = ast.parse(source)
    assigned = module_assignments(tree)
    namespace = {
        "BaseModel": BaseModel,
        "Field": Field,
        "Literal": Literal,
        "Optional": Optional,
        "field_validator": field_validator,
        "model_validator": model_validator,
        "household_impact": household_impact,
        "MAX_AMOUNT": ast.literal_eval(assigned["MAX_AMOUNT"]),
        "POLICY_YEARS": policy_years,
    }
    classes = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
    for name in MODELS:
        exec(compile(ast.Module(body=[classes[name]], type_ignores=[]), f"api.py:{name}", "exec"), namespace)
    # The mirror copies these validators' rules by hand; another validator
    # must be copied too before the capture is trusted, and their code is
    # kept in the fixture, so apiMirror.test.ts sees a change to one
    for name in MODELS:
        decorators = namespace[name].__pydantic_decorators__
        found = {
            kind: sorted(getattr(decorators, kind))
            for kind in ("validators", "field_validators", "root_validators", "field_serializers",
                         "model_serializers", "model_validators", "computed_fields")
            if getattr(decorators, kind)
        }
        assert found == VALIDATORS.get(name, {}), f"{name} has validators {found}"
    validators = {
        node.name: ast.unparse(node)
        for node in classes["HouseholdImpactRequest"].body
        if isinstance(node, ast.FunctionDef) and node.decorator_list
    }
    return namespace["HouseholdImpactRequest"], validators


VALIDATORS = {
    "HouseholdImpactRequest": {
        "field_validators": ["_known_measures", "_policy_year", "_salary_year"],
        "model_validators": ["_salary_not_after_year"],
    },
}

# The JSON schema's keywords that say what a value may be
SCHEMA_KEYWORDS = {
    "$defs", "$ref", "additionalProperties", "anyOf", "default", "enum", "items", "maxItems",
    "maximum", "minItems", "minimum", "properties", "required", "type",
}


def validation_schema(node):
    """The JSON schema without its titles and descriptions."""
    if isinstance(node, list):
        return [validation_schema(item) for item in node]
    if not isinstance(node, dict):
        return node
    kept = {}
    for key, value in node.items():
        if key in ("properties", "$defs"):
            kept[key] = {name: validation_schema(child) for name, child in value.items()}
        elif key in SCHEMA_KEYWORDS:
            kept[key] = value if key in ("default", "enum", "required") else validation_schema(value)
        else:
            assert key in ("title", "description"), f"Unexpected JSON schema keyword {key}"
    return kept


# --- Cases ---------------------------------------------------------------------

DASHBOARD_REQUESTS = {
    fixture["name"]: fixture["request"]
    for fixture in json.loads((HERE / "dashboard-households.json").read_text())["fixtures"]
}


# A case changes the base body: `set` gives paths new values and `remove`
# takes paths out; `body` replaces the whole body, and `fixture` is the
# request of that name in dashboard-households.json
def apply(base, case):
    if "body" in case:
        return copy.deepcopy(case["body"])
    if "fixture" in case:
        return copy.deepcopy(DASHBOARD_REQUESTS[case["fixture"]])
    body = copy.deepcopy(base)
    for path, value in case.get("set", []):
        target = body
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = copy.deepcopy(value)
    for path in case.get("remove", []):
        target = body
        for key in path[:-1]:
            target = target[key]
        del target[path[-1]]
    return body


def json_number(value):
    """The value as JavaScript would send it: integral numbers as integers."""
    if isinstance(value, float) and value.is_integer() and abs(value) < 2**53:
        return int(value)
    if isinstance(value, list):
        return [json_number(item) for item in value]
    if isinstance(value, dict):
        return {key: json_number(item) for key, item in value.items()}
    return value


PROTOTYPE_KEYS = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]
ANY = [
    None, True, False, 0, 1, 2, -1, 0.5, 30.5, -0.5, 1e308, 10**15,
    # Integers JavaScript writes in full (below 1e21): past an int64 too
    2**53, 10**19, -(10**19), 10**20, 999999999999999868928, 1e21, -1e21,
    "", "x", "30", " 30", "30 ", "+30", "-30", "30.0", "30.5", "3_0", "1e3", "0x1e", "030",
    "nan", "NaN", "inf", "-inf", "Infinity", "1e400", "true", "false", "yes", "None", "null",
    # How each language reads number text: underscores, signs, exponents,
    # other bases, other digits and other whitespace
    "3__0", "_30", "30_", "1_000.5", ".5", "5.", "30.", "30.00", "3e1", "1e", "1e-3", "1.5e3",
    "-0", "0030", "0b11", "0o7", "+inf", "-nan", "INF", "Infinity ", "\u066130", "\uff13\uff10",
    "\t30\n", "\u00a030", "30\u2003", "\u221230", "\u001c30", "\u008530", "\ufeff30", "\u200b30",
    [], [30], {}, {"value": 30},
]
BOOLEAN_TEXT = [
    "true", "false", "True", "FALSE", "yes", "no", "Yes", "y", "n", "on", "off", "On", "t", "f",
    "1", "0", " true", "true ", "2", "truthy", "",
]


def bounds_values(field_info):
    values = []
    for constraint in field_info.metadata:
        for name in ("ge", "le", "gt", "lt"):
            bound = getattr(constraint, name, None)
            if bound is not None:
                values += [bound, bound - 1, bound + 1, bound - 0.5, bound + 0.5, str(bound), str(bound + 1)]
    return values


def field_values(name, field_info, valid):
    annotation = str(field_info.annotation)
    values = list(ANY)
    if "bool" in annotation:
        values += BOOLEAN_TEXT
    if "Literal" in annotation:
        values += [valid[0], valid[-1], valid[0].lower(), valid[0] + " ", "MARS", 0]
    values += bounds_values(field_info)
    return values


def cases_for(model, base, choices):
    cases = []

    def add(name, **change):
        cases.append({"name": name, **change})

    # The body
    add("the base body")
    for value in [None, [], "x", 1, True, {}]:
        add(f"body = {json.dumps(value)}", body=value)
    for key in ["year", "policies", "household", "include"]:
        add(f"without {key}", remove=[[key]])
    for key in ["unknown", "Year", *PROTOTYPE_KEYS]:
        add(f"{key} at the top", set=[[[key], 0]])

    # The year and the salary year
    for year in [*choices["policy_years"], 2025, 2032, 0, "2027", " 2027", 2027.5, None, True, "x"]:
        add(f"year = {json.dumps(year)}", set=[[["year"], year]])
    for year in [2026, 2027, 2031]:
        for salary_year in [2025, 2026, 2027, 2031, 2032, "2026", 2026.5, None, True]:
            add(
                f"year {year}, salary_year = {json.dumps(salary_year)}",
                set=[[["year"], year], [["household", "salary_year"], salary_year]],
            )
        add(f"year {year} without salary_year", set=[[["year"], year]], remove=[["household", "salary_year"]])

    # The measures and the parts
    ids = choices["measure_ids"]
    policies = [
        None, [], ids[:1], ids, ids[:1] * 2, ["a"], [ids[0], "a"], [1], [None], [True], ids[0], {},
        ["autumn_budget_2026_combined"], [ids[0].upper()], [ids[0] + " "],
    ]
    for value in policies:
        add(f"policies = {json.dumps(value)}", set=[[["policies"], value]])
    parts = list(choices["parts"])
    for value in [None, [], parts, parts[:1], parts[::-1], parts * 2, ["x"], [None], [1], parts[0], {}, [parts[0].upper()]]:
        add(f"include = {json.dumps(value)}", set=[[["include"], value]])

    # The household's fields
    for value in [None, [], "x", 1, True]:
        add(f"household = {json.dumps(value)}", set=[[["household"], value]])
    add("household = {}", set=[[["household"], {}]])
    literal_choices = {
        "student_loan_plan": choices["student_loan_plans"],
        "partner_student_loan_plan": choices["student_loan_plans"],
        "region": choices["regions"],
        "tenure": choices["tenures"],
        "council_tax_band": choices["council_tax_bands"],
        "brma": choices["brmas"],
        "local_authority": choices["local_authorities"],
    }
    answers = model.model_fields["household"].annotation
    for name, field_info in answers.model_fields.items():
        if name == "children":
            continue
        add(f"without household.{name}", set=[[["household", name], 0]], remove=[["household", name]])
        for value in field_values(name, field_info, literal_choices.get(name, ["x"])):
            add(f"household.{name} = {json.dumps(value)}", set=[[["household", name], value]])
    for key in ["unknown", "Age", "partner", *PROTOTYPE_KEYS]:
        add(f"household.{key}", set=[[["household", key], 0]])

    # Children
    child = {"age": 5}
    children = [
        [], [child], [child] * 10, [child] * 11, [None], [5], ["5"], [[]], child, "x", None,
        [{}], [{"in_education": True}], [{"age": 5, "unknown": 1}], [{"age": 5, "Age": 1}],
        *[[{"age": 5, key: 1}] for key in PROTOTYPE_KEYS],
        [{"age": 5}] * 11 + [{"age": 30}],
        [{"age": 30}] * 11,
    ]
    for value in children:
        add(f"household.children = {json.dumps(value)}", set=[[["household", "children"], value]])
    for value in [*ANY, 19, 20, 0, -1, 18.5, "19", "20"]:
        add(f"child age = {json.dumps(value)}", set=[[["household", "children"], [{"age": value}]]])
    for value in [*ANY, *BOOLEAN_TEXT]:
        add(
            f"child in_education = {json.dumps(value)}",
            set=[[["household", "children"], [{"age": 17, "in_education": value}]]],
        )

    # Combinations
    rng = random.Random(SEED)
    singles = [case for case in cases if "set" in case and len(case["set"]) == 1 and not case.get("remove")]
    for index in range(COMBINATIONS):
        picked = rng.sample(singles, rng.randint(2, 5))
        changes = {}
        for case in picked:
            path, value = case["set"][0]
            # A later change inside a value replaced earlier would have no parent
            if any(path[: len(other)] == other or other[: len(path)] == path for other in map(json.loads, changes)):
                continue
            changes[json.dumps(path)] = value
        add(f"combination {index + 1}", set=[[json.loads(path), value] for path, value in changes.items()])

    # The dashboard's own requests
    for name in DASHBOARD_REQUESTS:
        add(f"dashboard-households: {name}", fixture=name)
    return cases


def error_location(loc) -> str:
    return ".".join(str(part) for part in loc) or "(body)"


def verdict(model, body):
    text = json.dumps(body, allow_nan=False)
    verdicts = []
    for validate in (lambda: model.model_validate(json.loads(text)), lambda: model.model_validate_json(text)):
        try:
            validate()
            verdicts.append({"accepted": True, "errors": []})
        except ValidationError as error:
            errors = sorted({f"{error_location(e['loc'])}: {e['type']}" for e in error.errors()})
            verdicts.append({"accepted": False, "errors": errors})
    if verdicts[0] != verdicts[1]:
        raise SystemExit(f"pydantic's Python and JSON modes differ on {text}: {verdicts}")
    return verdicts[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dashboard", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--policyengine-uk", type=Path, required=True)
    parser.add_argument("--uk-version", required=True)
    args = parser.parse_args()
    dashboard = args.dashboard.expanduser()
    uk = args.policyengine_uk.expanduser()
    commit = resolve_commit(dashboard, args.commit)

    budget_years = json.loads(git_show(dashboard, commit, "src/uk_budget_data/budget_years.json"))
    policy_years = budget_years["policy_years"]
    ids = measure_ids(dashboard, commit)
    household_impact = household_impact_choices(dashboard, commit, uk, args.uk_version)
    household_impact.measure_ids = lambda: list(ids)
    # Named only in the return annotation of HouseholdAnswersRequest.answers(),
    # which validation does not call
    household_impact.HouseholdAnswers = household_impact.Child = object
    check_wiring(dashboard, commit)
    model, validators = request_models(dashboard, commit, household_impact, policy_years)

    choices = {
        "policy_years": policy_years,
        "measure_ids": ids,
        "parts": list(household_impact.PARTS),
        "regions": list(household_impact.REGIONS),
        "tenures": list(household_impact.TENURES),
        "student_loan_plans": list(household_impact.STUDENT_LOAN_PLANS),
        "council_tax_bands": list(household_impact.COUNCIL_TAX_BANDS),
        "brmas": list(household_impact.BRMAS),
        "local_authorities": list(household_impact.LOCAL_AUTHORITIES),
        "oldest_child_age": household_impact.OLDEST_CHILD_AGE,
        "salary_year": household_impact.SALARY_YEAR,
    }
    base = copy.deepcopy(DASHBOARD_REQUESTS["defaults"])
    base["policies"] = ids[:2]
    base["include"] = list(household_impact.PARTS)
    base["household"]["children"] = [{"age": 4}, {"age": 17, "in_education": True}]
    cases = []
    for case in cases_for(model, base, choices):
        case = json_number(case)
        cases.append({**case, **verdict(model, apply(base, case))})
    assert verdict(model, base)["accepted"], "The base body must be one the API accepts"

    header = {
        "_note": (
            "What the Autumn Budget 2026 dashboard's household impact API accepts: its request models "
            "run under pydantic on each case. Written by capture_household_impact_api.py; regenerate "
            "with it rather than editing by hand."
        ),
        "source": {
            "dashboard": "PolicyEngine/uk-autumn-budget-dashboard-2026",
            "commit": commit,
            "policyengine_uk": args.uk_version,
            "pydantic": pydantic.VERSION,
            "seed": SEED,
        },
        "choices": {name: json.dumps(value, ensure_ascii=False) for name, value in choices.items()},
        "schema": json.dumps(validation_schema(model.model_json_schema()), ensure_ascii=False),
        "validators": json.dumps(validators, ensure_ascii=False),
        "base": json.dumps(base, ensure_ascii=False),
    }
    # One choice list and one case a line, so a recapture's diff reads
    lines = ["{"]
    lines += [f' "{key}": {json.dumps(header[key], ensure_ascii=False)},' for key in ("_note", "source")]
    lines.append(' "choices": {')
    lines += [f'  "{name}": {value},' for name, value in header["choices"].items()]
    lines[-1] = lines[-1].rstrip(",")
    lines += [" },", f' "schema": {header["schema"]},', f' "validators": {header["validators"]},']
    lines += [f' "base": {header["base"]},', ' "cases": [']
    lines += [f"  {json.dumps(case, ensure_ascii=False)}," for case in cases]
    lines[-1] = lines[-1].rstrip(",")
    lines += [" ]", "}"]
    OUT.write_text("\n".join(lines) + "\n")
    assert json.loads(OUT.read_text())["cases"] == cases
    accepted = sum(case["accepted"] for case in cases)
    print(f"Wrote {OUT.name}: {len(cases)} cases, {accepted} accepted")


if __name__ == "__main__":
    main()
