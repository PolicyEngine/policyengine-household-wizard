"""Capture what the household impact API accepts, for the wizard's tests.

The Autumn Budget 2026 dashboard checks a ``POST /api/household-impact`` body
with three pydantic models in its ``src/uk_budget_data/api.py``
(``HouseholdChildRequest``, ``HouseholdAnswersRequest`` and
``HouseholdImpactRequest``), which its FastAPI endpoint takes the body as.
This script reads those classes, and the choices they name, from git at the
given commits, serves them from a FastAPI endpoint of the same shape, and
writes ``household-impact-api.json`` next to it:

- ``choices``: the regions, tenures, student loan plans, Council Tax bands,
  Broad Rental Market Areas, local authorities, parts, policy years and
  measure ids the models accept;
- ``base`` and ``cases``: a valid body, and changes to it (one field set to
  each kind of value pydantic might take or refuse, children, unknown and
  prototype keys, the year rules, random combinations of these, and the
  requests in ``dashboard-households.json``), each with the endpoint's
  verdict: accepted or not, and the location and type of each error in its
  422.

``tests/uk-household/apiMirror.test.ts`` checks that
``reference/householdImpactApi.ts`` gives every case the same verdict.

The classes are run on their own, with the choices they read from
``household_impact`` filled in, so neither policyengine-uk nor the dashboard
needs installing. Run it from the wizard's root, with the pydantic,
pydantic-core, FastAPI and Starlette versions the dashboard's ``uv.lock``
pins at that commit (the script stops on any other):

    uv run --no-project --python 3.13 --with pydantic==2.12.5 \\
      --with fastapi==0.122.0 --with starlette==0.50.0 --with httpx==0.28.1 \\
      tests/fixtures/uk/capture_household_impact_api.py \\
      --dashboard ~/PolicyEngine/uk-autumn-budget-dashboard-2026 \\
      --commit <dashboard commit> \\
      --policyengine-uk ~/PolicyEngine/policyengine-uk

It reads policyengine-uk at the version ``uv.lock`` pins (its git tag).
"""

import argparse
import ast
import copy
import json
import random
import subprocess
import tomllib
from pathlib import Path
from types import SimpleNamespace
from typing import Literal, Optional

import fastapi
import pydantic
import pydantic_core
import starlette
from fastapi import FastAPI
from fastapi.testclient import TestClient
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


# The packages that decide the verdicts, and the versions running here
RUNNING = {
    "pydantic": pydantic.VERSION,
    "pydantic-core": pydantic_core.__version__,
    "fastapi": fastapi.__version__,
    "starlette": starlette.__version__,
}


def locked_versions(dashboard: Path, commit: str) -> dict[str, str]:
    """The versions the dashboard's uv.lock pins at the commit."""
    lock = tomllib.loads(git_show(dashboard, commit, "uv.lock"))
    return {package["name"]: package["version"] for package in lock["package"] if "version" in package}


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
    read = (
        "REGIONS", "TENURES", "OLDEST_CHILD_AGE", "SALARY_YEAR", "PARTS", "ELECTRICITY_SPENDING",
        "STUDENT_LOAN_PLANS", "BRMAS", "LOCAL_AUTHORITIES", "COUNCIL_TAX_BANDS",
    )
    bound_once(tree, "household_impact.py", *read)
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
        bound_once(tree, "household_impact.py", enum)
        choices[name] = enum_names(uk, version, imported[enum], enum)
    return SimpleNamespace(**choices)


DEFINITIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
# The methods that change a list, dict or set in place
MUTATORS = {
    "append", "extend", "insert", "remove", "pop", "clear", "sort", "reverse", "update", "setdefault",
    "popitem", "add", "discard", "__setitem__", "__delitem__", "__setattr__", "__delattr__",
}


def chain_root(node: ast.expr) -> str | None:
    """The name an attribute or subscript chain starts from (``a`` in ``a.b[0]``)."""
    while isinstance(node, (ast.Attribute, ast.Subscript)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def changed_names(node: ast.AST) -> set[str]:
    """The names whose values the code changes in place: an attribute or item
    set or deleted (``a.b = …``, ``del a[0]``), a mutating method called
    (``a.pop()``), or ``setattr``/``delattr`` on one."""
    names = set()
    for child in ast.walk(node):
        if isinstance(child, (ast.Attribute, ast.Subscript)) and isinstance(child.ctx, (ast.Store, ast.Del)):
            names.add(chain_root(child))
        elif isinstance(child, ast.Call):
            if isinstance(child.func, ast.Attribute) and child.func.attr in MUTATORS:
                names.add(chain_root(child.func.value))
            elif isinstance(child.func, ast.Name) and child.func.id in ("setattr", "delattr") and child.args:
                names.add(chain_root(child.args[0]))
    return names - {None}


def bound_names(statement: ast.stmt) -> set[str]:
    """The module's names a top-level statement binds or changes: what it
    assigns, defines or imports, what a function it defines declares
    ``global``, and what it changes in place (``changed_names``, in a
    function's body too)."""
    if isinstance(statement, DEFINITIONS):
        declared = {name for node in ast.walk(statement) if isinstance(node, ast.Global) for name in node.names}
        return {statement.name} | declared | changed_names(statement)
    names = changed_names(statement)
    for node in ast.walk(statement):
        if isinstance(node, DEFINITIONS):
            names.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names.update((alias.asname or alias.name).split(".")[0] for alias in node.names)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            names.add(node.id)
    return names


def bound_once(tree: ast.Module, where: str, *names: str):
    """Stop unless each name is bound by one top-level statement and never
    changed: the capture reads its one value."""
    for name in names:
        found = bindings(tree, name)
        assert len(found) == 1, f"{where} binds or changes {name} {len(found)} times: {found}"


def bindings(tree: ast.Module, name: str) -> list[str]:
    """Each top-level statement that binds ``name``, as ``ast.unparse`` gives
    it: a function or class without its docstring, and an import as the one
    name it brings in."""
    found = []
    for statement in tree.body:
        if name not in bound_names(statement):
            continue
        if isinstance(statement, (ast.Import, ast.ImportFrom)):
            source = (
                f"from {'.' * statement.level}{statement.module or ''} import "
                if isinstance(statement, ast.ImportFrom)
                else "import "
            )
            found += [
                source + alias.name + (f" as {alias.asname}" if alias.asname else "")
                for alias in statement.names
                if (alias.asname or alias.name).split(".")[0] == name
            ]
            continue
        if isinstance(statement, DEFINITIONS) and ast.get_docstring(statement) is not None:
            statement = copy.copy(statement)
            statement.body = statement.body[1:] or [ast.Pass()]
        found.append(ast.unparse(statement))
    return found


def function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise SystemExit(f"No function {name}")


GET_REFORMS = """\
def _get_autumn_budget_2026_reforms() -> list[Reform]:
    global _AUTUMN_BUDGET_2026_REFORMS_CACHE
    if _AUTUMN_BUDGET_2026_REFORMS_CACHE is None:
        members = [factory() for factory in _MEASURE_FACTORIES]
        _AUTUMN_BUDGET_2026_REFORMS_CACHE = [_create_combined_autumn_budget_reform(members), *members]
    return _AUTUMN_BUDGET_2026_REFORMS_CACHE"""

# The names the choices and the models' rules are read through, by file, and
# the statements that bind each (`bindings`). The capture stops if one changes
# or another statement binds the name, since the reading would then be wrong.
WIRING = {
    ("household_impact.py", "measure_ids"): [
        "def measure_ids() -> list[str]:\n"
        "    return [reform.id for reform in get_autumn_budget_2026_reforms() "
        "if reform.id != AUTUMN_BUDGET_2026_COMBINED_ID]"
    ],
    ("household_impact.py", "get_autumn_budget_2026_reforms"): [
        "from uk_budget_data.reforms import get_autumn_budget_2026_reforms"
    ],
    ("household_impact.py", "AUTUMN_BUDGET_2026_COMBINED_ID"): [
        "from uk_budget_data.reforms import AUTUMN_BUDGET_2026_COMBINED_ID"
    ],
    ("reforms.py", "get_autumn_budget_2026_reforms"): [
        "def get_autumn_budget_2026_reforms() -> list[Reform]:\n    return _get_autumn_budget_2026_reforms()"
    ],
    ("reforms.py", "_get_autumn_budget_2026_reforms"): [GET_REFORMS],
    ("reforms.py", "_AUTUMN_BUDGET_2026_REFORMS_CACHE"): [
        "_AUTUMN_BUDGET_2026_REFORMS_CACHE: list[Reform] | None = None",
        GET_REFORMS,
    ],
    ("reforms.py", "AUTUMN_BUDGET_2026_COMBINED_ID"): [
        "AUTUMN_BUDGET_2026_COMBINED_ID = 'autumn_budget_2026_combined'"
    ],
    ("budget_years.py", "_CONFIG"): [
        "_CONFIG = json.loads(files('uk_budget_data').joinpath('budget_years.json').read_text())"
    ],
    ("budget_years.py", "POLICY_YEARS"): ["POLICY_YEARS = _CONFIG['policy_years']"],
    ("api.py", "POLICY_YEARS"): ["from uk_budget_data.budget_years import POLICY_YEARS"],
    ("api.py", "household_impact"): ["from uk_budget_data import household_impact"],
    # The names request_models fills in for the classes
    ("api.py", "BaseModel"): ["from pydantic import BaseModel"],
    ("api.py", "Field"): ["from pydantic import Field"],
    ("api.py", "field_validator"): ["from pydantic import field_validator"],
    ("api.py", "model_validator"): ["from pydantic import model_validator"],
    ("api.py", "Literal"): ["from typing import Literal"],
    ("api.py", "Optional"): ["from typing import Optional"],
    # And the names the app is built with
    ("api.py", "FastAPI"): ["from fastapi import FastAPI"],
    ("api.py", "Query"): ["from fastapi import Query"],
    ("api.py", "Response"): ["from fastapi import Response"],
    ("api.py", "CORSMiddleware"): ["from fastapi.middleware.cors import CORSMiddleware"],
    ("api.py", "lifespan"): [
        "@asynccontextmanager\nasync def lifespan(app: FastAPI):\n"
        "    try:\n        yield\n    finally:\n        stop_workers()"
    ],
}


def check_wiring(dashboard: Path, commit: str):
    trees = {
        path: ast.parse(git_show(dashboard, commit, f"src/uk_budget_data/{path}"))
        for path in {path for path, _ in WIRING}
    }
    for (path, name), expected in WIRING.items():
        found = bindings(trees[path], name)
        assert found == expected, f"{path} binds {name} differently now: {found!r}"
    # measure_ids() leaves the combined reform out by its id
    combined = [
        ast.unparse(keyword.value)
        for node in ast.walk(function(trees["reforms.py"], "_create_combined_autumn_budget_reform"))
        if isinstance(node, ast.Call)
        for keyword in node.keywords
        if keyword.arg == "id"
    ]
    assert combined == ["AUTUMN_BUDGET_2026_COMBINED_ID"], f"The combined reform's id is {combined}"
    # The app: how api.py builds it, its middleware, its exception handlers,
    # its routes, and the household impact endpoint's parameters
    found = app_wiring(trees["api.py"])
    assert found == APP_WIRING, f"api.py builds or changes app differently now: {found!r}"


# Keywords that only document an API (its OpenAPI page), not what it accepts
DOCUMENTATION = {
    "title", "description", "summary", "version", "examples", "openapi_examples", "deprecated",
    "include_in_schema", "contact", "license_info", "openapi_tags", "tags", "response_description",
}
HOUSEHOLD_ROUTE = "app.post('/api/household-impact')"


class Undocumented(ast.NodeTransformer):
    def visit_Call(self, node):
        self.generic_visit(node)
        node.keywords = [keyword for keyword in node.keywords if keyword.arg not in DOCUMENTATION]
        return node


def names_app(node: ast.AST) -> bool:
    return any(isinstance(child, ast.Name) and child.id == "app" for child in ast.walk(node))


def app_wiring(api: ast.Module) -> list[str]:
    """How api.py builds and changes ``app``, as ``ast.unparse`` gives it
    without documentation keywords: each top-level statement that names
    ``app`` (``app = FastAPI(...)``, ``app.add_middleware(...)``), each other
    route by its decorators and name, the household impact route with its
    whole signature, and a function whose body names ``app`` in full."""
    found = []
    for statement in api.body:
        statement = Undocumented().visit(copy.deepcopy(statement))
        if not isinstance(statement, DEFINITIONS):
            if names_app(statement):
                found.append(ast.unparse(statement))
            continue
        if any(names_app(node) for node in statement.body):
            if ast.get_docstring(statement) is not None:
                statement.body = statement.body[1:] or [ast.Pass()]
            found.append(ast.unparse(statement))
            continue
        decorators = [decorator for decorator in statement.decorator_list if names_app(decorator)]
        if not decorators:
            continue
        if HOUSEHOLD_ROUTE in map(ast.unparse, decorators):
            statement.body = [ast.Expr(ast.Constant(...))]
            found.append(ast.unparse(statement))
        else:
            found.append("".join(f"@{ast.unparse(decorator)}\n" for decorator in decorators) + statement.name)
    return found


# What app_wiring finds in api.py: the capture stops if any of it changes,
# since the endpoint it serves the models from would then differ from the
# API's (a body embedded under a key, a required query, an exception handler
# or middleware that answers in place of the 422, another route for the path)
APP_WIRING = [
    "app = FastAPI(lifespan=lifespan)",
    "app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=True, allow_methods=['*'], "
    "allow_headers=['*'])",
    "@app.post('/api/personal-impact')\ncalculate_personal_impact",
    "@app.post('/api/personal-impact/stream')\ncalculate_personal_impact_stream",
    "@app.post('/api/household-impact')\n"
    "async def calculate_household_impact(data: HouseholdImpactRequest, response: Response, "
    "definition: list[str]=Query(default=[])):\n    ...",
    "@app.get('/api/health')\nhealth_check",
    "@app.get('/api/version')\nversion",
    "def main():\n"
    "    import uvicorn\n"
    "    port = int(os.environ.get('PORT', 5001))\n"
    "    print(f'Starting UK Budget Personal Impact API on port {port}...')\n"
    "    uvicorn.run(app, host='0.0.0.0', port=port)",
]


def measure_ids(dashboard: Path, commit: str) -> list[str]:
    """The ids of ``_MEASURE_FACTORIES``' reforms, in order: what
    ``household_impact.measure_ids()`` returns (every single measure)."""
    tree = ast.parse(git_show(dashboard, commit, "src/uk_budget_data/reforms.py"))
    bound_once(tree, "reforms.py", "_MEASURE_FACTORIES")
    assigned = module_assignments(tree)
    constants = {
        name: value.value
        for name, value in assigned.items()
        if isinstance(value, ast.Constant) and isinstance(value.value, str)
    }
    factories = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
    ids = []
    for factory in assigned["_MEASURE_FACTORIES"].elts:
        bound_once(tree, "reforms.py", factory.id)
        reform_ids = [
            keyword.value
            for node in ast.walk(factories[factory.id])
            if isinstance(node, ast.Call)
            for keyword in node.keywords
            if keyword.arg == "id"
        ]
        assert len(reform_ids) == 1, factory.id
        value = reform_ids[0]
        if isinstance(value, ast.Name):
            bound_once(tree, "reforms.py", value.id)
        ids.append(constants[value.id] if isinstance(value, ast.Name) else ast.literal_eval(value))
    return ids


def request_models(dashboard: Path, commit: str, household_impact: SimpleNamespace, policy_years: list[int]):
    source = git_show(dashboard, commit, "src/uk_budget_data/api.py")
    tree = ast.parse(source)
    # The classes are run once, as written, with MAX_AMOUNT's one value; the
    # names they take from pydantic and typing are checked in WIRING
    bound_once(tree, "api.py", "MAX_AMOUNT", *MODELS)
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
    # How pydantic-core reads underscores (once the text is trimmed, or
    # untrimmed with them taken out, for a float), leading zeros (with
    # underscores among them, or a minus sign after them for an int) and signs
    " 1_0", "1_0 ", "1_0\t", "1._5", "1_.5", "+_1", "-_1", "1_e5", "1e_5", "i_nf", " i_nf", "n_an",
    "0__1", "0_0", "00__0", "0_", "0-1", "00-5", "-0_1", "-0-1", "1_0.0", "1_0.00", "1.0_0", "0.",
    "00.0", "0_.0", "+-1", "-+1", "--1", "++1", "-", "+", "+0",
    # Unpaired surrogates, which JSON can carry and UTF-8 cannot
    "\ud800", "2027\udc00",
    # Integers past 2**53 that fit an int64, as JavaScript writes them
    4611686018427388000, -4611686018427388000,
    [], [30], {}, {"value": 30},
]
# Integer text around jiter's limit of 4,300 characters for a run of digits
# (with its minus sign), set on one integer and one float field
LONG_NUMBER_TEXT = [
    "1" * 4300, "1" * 4301, "-" + "1" * 4299, "-" + "1" * 4300, "+" + "1" * 4300, "+" + "1" * 4301,
    " " + "1" * 4301, "1" * 4301 + " ", "1" * 4300 + ".0", "1" * 4301 + ".0", "1" * 4299 + "_11",
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
    for key in ["unknown", "Year", *PROTOTYPE_KEYS, "\ud800"]:
        add(f"{json.dumps(key)[1:-1]} at the top", set=[[[key], 0]])

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
    for key in ["unknown", "Age", "partner", *PROTOTYPE_KEYS, "\ud800"]:
        add(f"household.{json.dumps(key)[1:-1]}", set=[[["household", key], 0]])

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

    # Long number text, after the combinations so they do not copy it
    for path in [["year"], ["household", "employment_income"]]:
        for value in LONG_NUMBER_TEXT:
            add(f"{'.'.join(path)} = {value[:3]}… ({len(value)} characters)", set=[[path, value]])

    # The dashboard's own requests
    for name in DASHBOARD_REQUESTS:
        add(f"dashboard-households: {name}", fixture=name)
    return cases


def error_location(loc) -> str:
    return ".".join(str(part) for part in loc) or "(body)"


def endpoint(model) -> TestClient:
    """A FastAPI endpoint that takes the body as the model, as the dashboard's
    does (``endpoint_body``), and accepts what it validates."""
    app = FastAPI()

    @app.post("/api/household-impact")
    async def household_impact(data: model):  # type: ignore[valid-type]
        return {}

    return TestClient(app, raise_server_exceptions=False)


def holds_lone_surrogate(value) -> bool:
    if isinstance(value, str):
        return any(0xD800 <= ord(character) <= 0xDFFF for character in value)
    if isinstance(value, list):
        return any(map(holds_lone_surrogate, value))
    if isinstance(value, dict):
        return any(holds_lone_surrogate(key) or holds_lone_surrogate(item) for key, item in value.items())
    return False


def verdict(client, model, body):
    """The endpoint's verdict on the body, sent as JSON: accepted, or its
    422's errors (FastAPI puts ``body`` first in each location), or a 500
    (``(body): server_error``), which it gives a body holding an unpaired
    surrogate."""
    text = json.dumps(body, allow_nan=False)
    response = client.post("/api/household-impact", content=text, headers={"content-type": "application/json"})
    if response.status_code == 200:
        found = {"accepted": True, "errors": []}
    elif response.status_code == 500:
        assert holds_lone_surrogate(body), f"500 for {text}"
        found = {"accepted": False, "errors": ["(body): server_error"]}
    else:
        assert response.status_code == 422, f"{response.status_code} for {text}"
        locations = [error["loc"] for error in response.json()["detail"]]
        assert all(loc[0] == "body" for loc in locations), locations
        found = {
            "accepted": False,
            "errors": sorted(
                {f"{error_location(error['loc'][1:])}: {error['type']}" for error in response.json()["detail"]}
            ),
        }
    # The models refuse what the endpoint refuses
    try:
        model.model_validate(json.loads(text))
        accepted = True
    except (ValidationError, UnicodeEncodeError):
        accepted = False
    assert accepted == found["accepted"], f"The endpoint and its model differ on {text}"
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dashboard", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--policyengine-uk", type=Path, required=True)
    args = parser.parse_args()
    dashboard = args.dashboard.expanduser()
    uk = args.policyengine_uk.expanduser()
    commit = resolve_commit(dashboard, args.commit)

    locked = locked_versions(dashboard, commit)
    for package, version in RUNNING.items():
        assert locked.get(package) == version, (
            f"{package} {version} is running, but the dashboard's uv.lock pins {locked.get(package)}"
        )
    uk_version = locked["policyengine-uk"]
    budget_years = json.loads(git_show(dashboard, commit, "src/uk_budget_data/budget_years.json"))
    policy_years = budget_years["policy_years"]
    ids = measure_ids(dashboard, commit)
    household_impact = household_impact_choices(dashboard, commit, uk, uk_version)
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
    client = endpoint(model)
    cases = []
    for case in cases_for(model, base, choices):
        case = json_number(case)
        cases.append({**case, **verdict(client, model, apply(base, case))})
    assert verdict(client, model, base)["accepted"], "The base body must be one the API accepts"

    header = {
        "_note": (
            "What the Autumn Budget 2026 dashboard's household impact API accepts: its request models "
            "served from a FastAPI endpoint, posted each case. Written by capture_household_impact_api.py; "
            "regenerate with it rather than editing by hand."
        ),
        "source": {
            "dashboard": "PolicyEngine/uk-autumn-budget-dashboard-2026",
            "commit": commit,
            "policyengine_uk": uk_version,
            **{package.replace("-", "_"): version for package, version in RUNNING.items()},
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
    # ASCII, so an unpaired surrogate is written as its escape
    lines += [f"  {json.dumps(case)}," for case in cases]
    lines[-1] = lines[-1].rstrip(",")
    lines += [" ]", "}"]
    OUT.write_text("\n".join(lines) + "\n")
    assert json.loads(OUT.read_text())["cases"] == cases
    accepted = sum(case["accepted"] for case in cases)
    print(f"Wrote {OUT.name}: {len(cases)} cases, {accepted} accepted")


if __name__ == "__main__":
    main()
