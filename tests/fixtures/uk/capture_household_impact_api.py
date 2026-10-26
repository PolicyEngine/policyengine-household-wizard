"""Capture what the household impact API accepts, for the wizard's tests.

The Autumn Budget 2026 dashboard checks a ``POST /api/household-impact`` body
with pydantic models in its ``src/uk_budget_data/api.py``. This script runs
the dashboard's own API at a commit, in the environment its ``uv.lock`` pins,
posts it each case below, and writes ``household-impact-api.json`` next to
it:

- ``choices``: the regions, tenures, student loan plans, Council Tax bands,
  Broad Rental Market Areas, local authorities, parts, policy years and
  measure ids the API accepts;
- ``schema``, ``validators`` and ``features``: the body model's JSON schema,
  the code of its validators, and the pydantic features its core schema
  uses, which ``reference/householdImpactApi.ts`` mirrors;
- ``code``: the code of the dashboard's other functions that ran while it
  answered the cases, and ``files``: the sha256 of each of the commit's
  files its process loaded or opened through Python, which the mirror lists
  as read;
- ``environment``: the interpreter, its flags and options, the platform,
  each package installed (its version and a digest of its files), the
  dashboard's entry points, uv's shim and the commit's files that decide
  them, which the mirror also lists as read;
- ``base`` and ``cases``: a valid body, and changes to it (one field set to
  each kind of value pydantic might take or refuse, each household field
  again with a partner, children, unknown and prototype keys, the year
  rules, random combinations of these, and the requests in
  ``dashboard-households.json``), each with the API's verdict: accepted or
  not, the location and type of each error FastAPI reports, and a 500.

Only the calculation is replaced (``household_impact.calculate_household_impact``),
so the API answers at once. Everything else runs as the dashboard wrote
it: the app and its lifespan, its middleware, FastAPI's validation of the
body and the endpoint's own code before and after the calculation. The
script stops if a case is refused anywhere but FastAPI's validation, since
the mirror covers only that. ``tests/uk-household/apiMirror.test.ts``
checks that the mirror gives every case the same verdict.

Run it from the wizard's root; it needs git and uv:

    uv run --no-project --python 3.13 tests/fixtures/uk/capture_household_impact_api.py \\
      --dashboard ~/PolicyEngine/uk-autumn-budget-dashboard-2026 --commit <commit>

It exports the commit's files to a temporary directory with ``git archive``,
so the dashboard's checkout is not touched, and runs itself there with
``uv run --frozen --exact``, which installs exactly what ``uv.lock`` pins.
It runs with ``-B`` and an empty ``pycache_prefix``, so no cached bytecode
runs, with ``-X utf8``, and without the ``PYTHON*`` environment variables
apart from ``PYTHONPATH``, so the interpreter runs in the same mode each
time. It stops if Python runs optimized (``-O``), which drops its checks.
``--source DIR`` uses an export made before, and ``--python`` the
interpreter of an environment already synced to its lock, so the capture
can run without a network. Either way, before it imports the dashboard, it
checks that the files are the commit's, that every installed package is the
version ``uv.lock`` pins, which the lock takes from PyPI, that each file its
``RECORD`` hashes is as the ``RECORD`` says, and that the packages deciding
the verdicts are imported from those installs, and that the project's
install adds nothing to site-packages but its metadata and ``.pth`` file.
It does not check the files against the wheels the lock pins: a package and
its ``RECORD`` changed together pass, but change the digest the environment
records. At the end it checks that every module loaded from a file, and
every file opened through Python, was the interpreter's, a package's in
site-packages that the digest covers, the commit's or this script.
"""

import argparse
import ast
import base64
import copy
import hashlib
import importlib.metadata
import inspect
import json
import os
import platform
import random
import re
import subprocess
import sys
import sysconfig
import tarfile
import tempfile
import textwrap
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "household-impact-api.json"
ROUTE = "/api/household-impact"
SEED = 20261025
COMBINATIONS = 400
# The packages that decide the verdicts, which must be imported from their
# installs
DECIDING = ("policyengine-uk", "pydantic", "pydantic-core", "fastapi", "starlette")
# Where every package must come from, so its version names one release
PYPI = {"registry": "https://pypi.org/simple"}
# The commit's files that decide the environment, recorded by sha256
ENVIRONMENT_INPUTS = (".python-version", "pyproject.toml", "uv.lock")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def resolve_commit(repo: Path, rev: str) -> str:
    return git(repo, "rev-parse", f"{rev}^{{commit}}").strip()


# --- The dashboard's files and environment -------------------------------------


def export(dashboard: Path, commit: str, into: Path):
    """The commit's files, from ``git archive``, so no checkout is touched."""
    archive = subprocess.Popen(["git", "-C", str(dashboard), "archive", commit], stdout=subprocess.PIPE)
    with tarfile.open(fileobj=archive.stdout, mode="r|") as tar:
        tar.extractall(into, filter="data")
    assert archive.wait() == 0, "git archive failed"


# What syncing an export adds to it: the environment, the project's
# metadata and Python's caches
BUILT = re.compile(r"(^\.venv/|^src/[^/]+\.egg-info/|(^|/)__pycache__/)")


def check_source(dashboard: Path, commit: str, source: Path) -> set[Path]:
    """Stop unless ``source`` holds exactly the commit's files, apart from
    what syncing it builds; the files, resolved."""
    tracked = {}
    for entry in git(dashboard, "ls-tree", "-r", "-z", "--full-tree", commit).split("\0"):
        if entry:
            meta, path = entry.split("\t", 1)
            mode, kind, blob = meta.split()
            assert kind == "blob" and mode in ("100644", "100755"), f"{path} is a {mode} {kind}"
            tracked[path] = blob
    found = {
        path.relative_to(source).as_posix()
        for path in source.rglob("*")
        if (path.is_file() or path.is_symlink()) and not BUILT.search(path.relative_to(source).as_posix())
    }
    assert found == set(tracked), (
        f"{source} is not the commit's files: extra {sorted(found - set(tracked))[:5]}, "
        f"missing {sorted(set(tracked) - found)[:5]}"
    )
    for path, blob in tracked.items():
        data = (source / path).read_bytes()
        assert hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest() == blob, f"{path} differs from the commit's"
    return {(source / path).resolve() for path in tracked}


def check_bytecode():
    """Stop unless Python reads and writes no cached bytecode: ``-B``, and
    ``-X pycache_prefix`` an empty directory, so every module runs from its
    source. ``-B`` alone still reads a ``__pycache__`` beside the source,
    which ``check_source`` lets through and need not match it."""
    assert sys.dont_write_bytecode, "Run with -B"
    prefix = sys.pycache_prefix
    assert prefix and Path(prefix).is_dir(), "Run with -X pycache_prefix=<an empty directory>"
    assert not any(Path(prefix).iterdir()), f"{prefix} holds cached bytecode"


def canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


# What uv puts in a virtual environment beside the packages it installs
VENV_SHIMS = {"_virtualenv.pth", "_virtualenv.py"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_environment(dashboard: Path, commit: str, source: Path) -> tuple[dict, set[Path]]:
    """Stop unless:

    - every package installed here is the version the dashboard's
      ``uv.lock`` pins at the commit, which the lock takes from PyPI;
    - every file a package's ``RECORD`` lists has a hash (the ``RECORD``
      itself apart) and is as the ``RECORD`` says, the project's own
      install included;
    - every ``.pth`` file belongs to an installed package or is uv's shim,
      and the project's runs no code;
    - the project's install puts nothing in site-packages but its
      dist-info and ``.pth`` files;
    - the deciding packages are imported from those installs.

    It runs once the interpreter has started, so a ``.pth`` file it stops on
    has run. Returns the environment and the files checked whose content it
    records: those in site-packages of every package but the project, the
    only installed files a module may be loaded from. The environment
    is the interpreter, its flags and the platform; each package's version
    and the sha256 of its files in site-packages, so a file changed along
    with its ``RECORD`` still changes the record; the project's entry
    points; the shim's sha256; and that of the commit's files that decide
    the rest."""
    lock = tomllib.loads(git(dashboard, "show", f"{commit}:uv.lock"))
    locked = {canonical(package["name"]): package for package in lock["package"]}
    project = canonical(tomllib.loads(git(dashboard, "show", f"{commit}:pyproject.toml"))["project"]["name"])
    sites = {Path(sysconfig.get_paths()[key]).resolve() for key in ("purelib", "platlib")}
    # Every copy on the path, so one shadowing another is checked too. The
    # project's own (its install, and the egg-info a build leaves in src/)
    # is imported from the source, which check_source checks; its install
    # names the export's path, so only its entry points are recorded
    installed, contents, entry_points, owned, checked = {}, {}, set(), set(), set()
    for dist in importlib.metadata.distributions():
        name = canonical(dist.metadata["Name"])
        owned.update(Path(dist.locate_file(file)).resolve() for file in dist.files or [])
        if name == project:
            entry_points |= {f"{point.group}: {point.name} = {point.value}" for point in dist.entry_points}
        else:
            assert name not in installed, f"{name} is installed twice ({installed[name]}, {dist.version})"
            installed[name] = dist.version
            pinned = locked.get(name, {})
            assert pinned.get("version") == dist.version, (
                f"{name} {dist.version} is installed, but uv.lock pins {pinned.get('version')}"
            )
            assert pinned.get("source") == PYPI, f"uv.lock takes {name} from {pinned.get('source')}, not PyPI"
        if dist.read_text("RECORD") is None:
            # The egg-info lists the project's sources, which check_source checks
            assert name == project, f"{name} has no RECORD to check its files against"
            continue
        listed = []
        for file in dist.files:
            if file.hash is None:
                assert file.name == "RECORD" and file.parent.name.endswith(".dist-info"), (
                    f"{name}'s RECORD gives {file} no hash"
                )
                continue
            located = Path(dist.locate_file(file)).resolve()
            digest = hashlib.new(file.hash.mode, located.read_bytes()).digest()
            assert base64.urlsafe_b64encode(digest).rstrip(b"=").decode() == file.hash.value, (
                f"{located} is not the file {name} {dist.version} installed"
            )
            site = next((site for site in sites if located.is_relative_to(site)), None)
            if site and name != project:
                listed.append(f"{located.relative_to(site).as_posix()}\t{file.hash.mode}={file.hash.value}")
                checked.add(located)
            if site and name == project:
                # Its code is the commit's: its install may only describe it
                relative = located.relative_to(site)
                assert relative.parts[0].endswith(".dist-info") or (
                    len(relative.parts) == 1 and located.suffix == ".pth"
                ), f"{name}'s install adds {relative} to site-packages"
            if name == project and located.suffix == ".pth":
                # site.py runs a line that starts with "import"; any other
                # line only adds a directory to the path
                lines = located.read_bytes().decode("utf-8-sig").splitlines()
                assert not any(line.startswith(("import ", "import\t")) for line in lines), f"{located} runs code"
        if name != project:
            contents[name] = hashlib.sha256("\n".join(sorted(listed)).encode()).hexdigest()
    shims = {}
    for directory in sorted(sites):
        for pth in directory.glob("*.pth"):
            assert pth.name in VENV_SHIMS or pth.resolve() in owned, f"{pth} belongs to no installed package"
        shims |= {name: sha256(shim) for name in sorted(VENV_SHIMS) if (shim := directory / name).is_file()}
    for name in DECIDING:
        module = importlib.import_module(name.replace("-", "_"))
        dist = importlib.metadata.distribution(name)
        files = {Path(dist.locate_file(file)).resolve() for file in dist.files}
        assert Path(module.__file__).resolve() in files, f"{module.__name__} is imported from {module.__file__}"
    environment = {
        "python": f"{sys.implementation.name} {platform.python_version()}",
        "flags": {flag: getattr(sys.flags, flag) for flag in type(sys.flags).__match_args__},
        "xoptions": {key: value for key, value in sys._xoptions.items() if key != "pycache_prefix"},
        "warnoptions": list(sys.warnoptions),
        "platform": sysconfig.get_platform(),
        "packages": dict(sorted(installed.items())),
        "contents": dict(sorted(contents.items())),
        "entry_points": sorted(entry_points),
        "shims": shims,
        "inputs": {name: sha256(source / name) if (source / name).is_file() else None for name in ENVIRONMENT_INPUTS},
    }
    return environment, checked


def check_interpreter():
    """Stop if Python runs optimized: ``-O`` and ``PYTHONOPTIMIZE`` drop
    every ``assert``, and with them the checks here."""
    if sys.flags.optimize:
        raise SystemExit("Run without -O or PYTHONOPTIMIZE, which drop the capture's checks")


def checked_file(tracked: set[Path], checked: set[Path]):
    """Whether a file is the interpreter's own library, a package's file in
    site-packages that a ``RECORD`` checked and the environment's digest
    covers (not the project's, nor one outside site-packages), one of the
    commit's, uv's shim (whose sha256 the environment records) or this
    script."""
    paths = sysconfig.get_paths()
    interpreter = [Path(paths[key]).resolve() for key in ("stdlib", "platstdlib")]
    sites = {Path(paths[key]).resolve() for key in ("purelib", "platlib")}

    def known(located: Path) -> bool:
        return (
            located in checked
            or located in tracked
            or located == Path(__file__).resolve()
            or (located.parent in sites and located.name in VENV_SHIMS)
            or (
                not any(located.is_relative_to(site) for site in sites)
                and any(located.is_relative_to(lib) for lib in interpreter)
            )
        )

    return known


def check_loaded(tracked: set[Path], checked: set[Path]):
    """Stop unless every module loaded from a file was loaded from a file
    ``checked_file`` knows, by both its spec's origin and its ``__file__``.
    A module with neither (built in, frozen, a namespace package, or one
    made at run time) has no file to check; one whose origin or ``__file__``
    is not a regular file, such as a path inside an archive, stops it."""
    known = checked_file(tracked, checked)
    for name, module in list(sys.modules.items()):
        spec = getattr(module, "__spec__", None)
        for file in {getattr(spec, "origin", None), getattr(module, "__file__", None)} - {None, "built-in", "frozen"}:
            assert isinstance(file, str) and Path(file).is_file(), f"{name} is loaded from {file!r}, not a file"
            assert known(Path(file).resolve()), f"{name} is loaded from {Path(file).resolve()}, which nothing checked"


def check_opened(tracked: set[Path], checked: set[Path], opened: "Opened"):
    """Stop unless every file opened through Python while the API ran, and
    still there, is one ``checked_file`` knows. A library that opens a
    file in C, as h5py does, is not seen."""
    known = checked_file(tracked, checked)
    for path in sorted(set(opened.paths)):
        located = Path(path).resolve()
        assert not located.is_file() or known(located), f"{located} was opened, but nothing checked it"


# --- What the mirror reads from the models ---------------------------------------


# Keys of the core schema that hold other nodes, or that only document it.
# pydantic-core does not read ``metadata`` (core_schema.py: "not used by
# pydantic-core"); ``serialization`` is how a value is dumped, which the
# endpoint does before it checks the request again
NESTED = {"schema", "items_schema", "fields", "definitions", "choices", "metadata", "serialization"}
NAMES = {"ref", "model_name", "schema_ref"}
# Keys whose values are data the JSON schema holds (a default, the choices,
# a bound), recorded by key only
DATA = {"default", "expected", "ge", "le", "gt", "lt", "max_length", "min_length", "multiple_of"}


def core_schema_features(schema) -> tuple[list[str], list, list]:
    """The pydantic features the core schema uses, as ``type``,
    ``type.key`` or ``type.key=value`` (a setting), with the functions it
    calls to validate and the models it builds. A serialization schema's
    features are listed too, after ``serialization:``."""
    features, functions, models = set(), [], []

    def walk(node, within=""):
        if isinstance(node, list):
            for item in node:
                walk(item, within)
            return
        if not isinstance(node, dict):
            return
        kind = node.get("type")
        if not isinstance(kind, str):
            for value in node.values():
                walk(value, within)
            return
        features.add(f"{within}{kind}")
        for key, value in node.items():
            if key == "type" or key in NAMES:
                continue
            if key == "config":
                features.update(
                    f"{within}{kind}.config.{name}={setting!r}" for name, setting in value.items() if name != "title"
                )
            elif key == "function" and isinstance(value, dict):
                features.add(f"{within}{kind}.function.{value['type']}")
                functions.append(value["function"])
            elif key == "function":
                # A serializer's function, which the mirror never copies
                features.add(f"{within}{kind}.function")
            elif key == "cls":
                if value not in models:
                    models.append(value)
            elif key == "computed_fields":
                assert not value, f"computed fields: {value}"
            elif key in DATA or key in NESTED or not isinstance(value, (bool, int, str, type(None))):
                if key != "metadata":
                    features.add(f"{within}{kind}.{key}")
            else:
                features.add(f"{within}{kind}.{key}={value!r}")
            # Into every node it holds, but not into data, documentation or
            # a function
            if key == "serialization":
                walk(value, f"{within}serialization:")
            elif key not in DATA and key not in ("metadata", "function", "cls", "config"):
                walk(value, within)

    walk(schema)
    return sorted(features), functions, models


# The kinds of decorator pydantic gives a model; the mirror copies validators
DECORATORS = (
    "validators", "field_validators", "root_validators", "field_serializers", "model_serializers",
    "model_validators", "computed_fields",
)


def validator_code(models: list, functions: list) -> tuple[dict[str, str], dict, list]:
    """The code of each model's validators, by name, as ``ast.unparse``
    gives it, the module globals they read, and the functions. Stops on a
    function in the core schema that is not one of them."""
    validators, unwrapped = {}, {}
    for model in models:
        decorators = model.__pydantic_decorators__
        for kind in DECORATORS:
            if kind not in ("field_validators", "model_validators"):
                assert not getattr(decorators, kind), f"{model.__name__} has {kind}"
        for kind in ("field_validators", "model_validators"):
            for name, decorator in getattr(decorators, kind).items():
                assert name not in validators, f"Two validators are named {name}"
                function = getattr(decorator.func, "__func__", decorator.func)
                source = textwrap.dedent(inspect.getsource(function))
                validators[name] = ast.unparse(ast.parse(source).body[0])
                unwrapped[id(function)] = function
    called = {id(getattr(function, "__func__", function)) for function in functions}
    assert called == set(unwrapped), "The core schema calls functions that are not the models' validators"
    namespaces = {id(function.__globals__): function.__globals__ for function in unwrapped.values()}
    assert len(namespaces) == 1, "The validators are defined in more than one module"
    return dict(sorted(validators.items())), next(iter(namespaces.values())), list(unwrapped.values())


# --- The dashboard's code that runs ----------------------------------------------


class DashboardCode:
    """The dashboard's own functions that start or resume while this is
    open, in any thread, found with ``sys.monitoring``: its endpoint, the
    code that runs before and after the calculation, its lifespan. A
    function is the dashboard's when its file is one of the commit's. Each
    is seen once."""

    EVENTS = sys.monitoring.events.PY_START | sys.monitoring.events.PY_RESUME

    def __init__(self, source: Path, tracked: set[Path], skip):
        self.source = source.resolve()
        self.tracked = tracked
        self.skip = {function.__code__ for function in skip}
        self.codes = {}

    def __enter__(self):
        monitoring = sys.monitoring
        self.tool = next(tool for tool in range(6) if monitoring.get_tool(tool) is None)
        monitoring.use_tool_id(self.tool, "capture")
        for event in (monitoring.events.PY_START, monitoring.events.PY_RESUME):
            monitoring.register_callback(self.tool, event, self.ran)
        monitoring.set_events(self.tool, self.EVENTS)
        return self

    def ran(self, code, offset):
        if code not in self.skip and Path(code.co_filename).resolve() in self.tracked:
            self.codes[code] = None
        return sys.monitoring.DISABLE

    def __exit__(self, *exception):
        monitoring = sys.monitoring
        monitoring.set_events(self.tool, 0)
        for event in (monitoring.events.PY_START, monitoring.events.PY_RESUME):
            monitoring.register_callback(self.tool, event, None)
        monitoring.free_tool_id(self.tool)

    def record(self) -> dict[str, str]:
        """Each function's code, as ``ast.unparse`` gives it without
        docstrings, by file and qualified name. A generator expression is
        part of the function it is in; one at a module's top level is in
        the module, which ``dashboard_files`` records."""
        record = {}
        for code in self.codes:
            if code.co_name.startswith("<") and code.co_name != "<lambda>":
                continue
            path = Path(code.co_filename).resolve()
            nodes = [
                node
                for node in ast.walk(ast.parse(path.read_text()))
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
                and getattr(node, "name", "<lambda>") == code.co_name
                and (node.decorator_list[0].lineno if getattr(node, "decorator_list", None) else node.lineno)
                == code.co_firstlineno
            ]
            name = f"{path.relative_to(self.source).as_posix()}:{code.co_qualname}"
            assert nodes, f"No code for {name}"
            record.setdefault(name, set()).update(map(undocumented, nodes))
        return {name: "\n".join(sorted(sources)) for name, sources in sorted(record.items())}


def undocumented(node) -> str:
    """The code as ``ast.unparse`` gives it, without the docstrings of the
    module, classes and functions in it."""
    node = copy.deepcopy(node)
    for inner in ast.walk(node):
        body = getattr(inner, "body", None)
        if (
            isinstance(inner, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
            and body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            inner.body = body[1:] or [ast.Pass()]
    return ast.unparse(node)


class Opened:
    """The files a Python audit hook sees opened from when this is made:
    through ``open`` or ``os.open``, as pandas and numpy read files too, but
    not by a C library that opens a file itself, as h5py's HDF5 does. A hook
    stays for the life of the process, so this one records until it ends."""

    def __init__(self):
        self.paths = set()
        sys.addaudithook(self.hook)

    def hook(self, event, args):
        if event == "open" and isinstance(args[0], (str, bytes)):
            self.paths.add(os.path.abspath(os.fsdecode(args[0])))


def dashboard_files(tracked: set[Path], source: Path, opened: Opened) -> dict[str, str]:
    """The sha256 of each of the commit's files this process loaded as a
    module or opened through Python: a Python file's code as
    ``undocumented`` gives it, another file's bytes. Reading the diff of
    these between two commits is reading every change to the commit's
    files the API runs or reads; ``environment`` covers what is installed."""
    paths = {Path(module.__file__).resolve() for module in list(sys.modules.values()) if getattr(module, "__file__", None)}
    paths |= {Path(path).resolve() for path in set(opened.paths) if Path(path).is_file()}
    record = {}
    for path in sorted(paths & tracked):
        data = undocumented(ast.parse(path.read_bytes())).encode() if path.suffix == ".py" else path.read_bytes()
        record[path.relative_to(source.resolve()).as_posix()] = hashlib.sha256(data).hexdigest()
    return record


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


def enum_of(schema: dict) -> list:
    """The one enum of a property, which may also be null."""
    enums = [option["enum"] for option in schema.get("anyOf", [schema]) if "enum" in option]
    assert len(enums) == 1, schema
    return enums[0]


def schema_choices(schema: dict) -> dict:
    """The choices the models accept, from their JSON schema."""
    definitions = schema["$defs"]
    answers = definitions["HouseholdAnswersRequest"]["properties"]
    plans = enum_of(answers["student_loan_plan"])
    assert enum_of(answers["partner_student_loan_plan"]) == plans
    return {
        "parts": enum_of(schema["properties"]["include"]["items"]),
        "regions": enum_of(answers["region"]),
        "tenures": enum_of(answers["tenure"]),
        "student_loan_plans": plans,
        "council_tax_bands": enum_of(answers["council_tax_band"]),
        "brmas": enum_of(answers["brma"]),
        "local_authorities": enum_of(answers["local_authority"]),
        "oldest_child_age": definitions["HouseholdChildRequest"]["properties"]["age"]["maximum"],
        "salary_year": answers["salary_year"]["default"],
    }


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
    # Unpaired surrogates, which JSON can carry and UTF-8 cannot, and a pair
    # (one character once sent)
    "\ud800", "2027\udc00", "\U0001f600",
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
SURROGATE = "\ud800"


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
    for value in [None, [], "x", 1, True, {}, [SURROGATE]]:
        add(f"body = {json.dumps(value)}", body=value)
    for key in ["year", "policies", "household", "include"]:
        add(f"without {key}", remove=[[key]])
    for key in ["unknown", "Year", *PROTOTYPE_KEYS, SURROGATE]:
        add(f"{json.dumps(key)[1:-1]} at the top", set=[[[key], 0]])
    add("unknown = a surrogate, at the top", set=[[["unknown"], SURROGATE]])

    # The year and the salary year
    for year in [*choices["policy_years"], 2025, 2032, 0, "2027", " 2027", 2027.5, None, True, "x", [SURROGATE]]:
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
        # An unpaired surrogate in a measure id, alone and beside items
        # refused for another reason, in either order
        [SURROGATE], [ids[0], SURROGATE], [0, SURROGATE], [SURROGATE, 0], [SURROGATE, None], [SURROGATE, {}],
        [SURROGATE, "a"], [SURROGATE, SURROGATE], {SURROGATE: 1}, {"a": SURROGATE},
    ]
    for value in policies:
        add(f"policies = {json.dumps(value)}", set=[[["policies"], value]])
    parts = list(choices["parts"])
    for value in [
        None, [], parts, parts[:1], parts[::-1], parts * 2, ["x"], [None], [1], parts[0], {}, [parts[0].upper()],
        [SURROGATE], [parts[0], SURROGATE],
    ]:
        add(f"include = {json.dumps(value)}", set=[[["include"], value]])

    # The household's fields
    for value in [None, [], "x", 1, True, [SURROGATE]]:
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
    # Again with a partner, so code that reads a partner's answers only
    # with a partner runs on each of them
    partnered = [["household", "has_partner"], True]
    for name, field_info in answers.model_fields.items():
        if name not in ("children", "has_partner"):
            for value in field_values(name, field_info, literal_choices.get(name, ["x"])):
                add(f"with a partner, household.{name} = {json.dumps(value)}", set=[partnered, [["household", name], value]])
    for key in ["unknown", "Age", "partner", *PROTOTYPE_KEYS, SURROGATE]:
        add(f"household.{json.dumps(key)[1:-1]}", set=[[["household", key], 0]])
    # An unpaired surrogate beside another refusal, and in a key beside one
    add("household: a surrogate region, a negative age", set=[[["household", "region"], SURROGATE], [["household", "age"], -1]])
    add("household: a surrogate key, a negative age", set=[[["household", SURROGATE], 0], [["household", "age"], -1]])
    add("a surrogate key, a year refused", set=[[[SURROGATE], 0], [["year"], 2025]])
    add("household.unknown = a surrogate", set=[[["household", "unknown"], SURROGATE]])
    add("household.region = an object with a surrogate key", set=[[["household", "region"], {SURROGATE: 1}]])
    # The input of a missing field's error is the whole object it is missing from
    add("without year, a surrogate beside a refused measure", set=[[["policies"], [0, SURROGATE]]], remove=[["year"]])
    # A surrogate measure id stops the validation with a 500 at once: before
    # or after the other errors, and the other refusals of the body?
    unknown_measure = [["policies"], [SURROGATE]]
    add("a surrogate measure, a year refused", set=[unknown_measure, [["year"], 2025]])
    add("a surrogate measure, an unknown key", set=[unknown_measure, [["unknown"], 0]])
    add("a surrogate measure, a surrogate key", set=[unknown_measure, [[SURROGATE], 0]])
    add("a surrogate measure, a negative age", set=[unknown_measure, [["household", "age"], -1]])
    add("a surrogate measure, a surrogate part", set=[unknown_measure, [["include"], [SURROGATE]]])

    # Children
    child = {"age": 5}
    children = [
        [], [child], [child] * 10, [child] * 11, [None], [5], ["5"], [[]], child, "x", None,
        [{}], [{"in_education": True}], [{"age": 5, "unknown": 1}], [{"age": 5, "Age": 1}],
        *[[{"age": 5, key: 1}] for key in PROTOTYPE_KEYS],
        [{"age": 5}] * 11 + [{"age": 30}],
        [{"age": 30}] * 11,
        [{"age": 5, SURROGATE: 1}], [{"age": 30, SURROGATE: 1}], [{"age": 30}, {"age": 5, SURROGATE: 1}],
        [{"age": SURROGATE}, {"age": 30}], [[SURROGATE]], {SURROGATE: 1}, [{"age": 5}] * 10 + [{"age": SURROGATE}],
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


# --- Verdicts ------------------------------------------------------------------


def error_location(loc) -> str:
    return ".".join(str(part) for part in loc) or "(body)"


def holds_lone_surrogate(value) -> bool:
    if isinstance(value, str):
        return re.search(r"[\ud800-\udfff]", value) is not None
    if isinstance(value, list):
        return any(map(holds_lone_surrogate, value))
    if isinstance(value, dict):
        return any(holds_lone_surrogate(key) or holds_lone_surrogate(item) for key, item in value.items())
    return False


def reported(errors) -> list[str]:
    """FastAPI's errors as ``location: type``, without the ``body`` it puts
    first in each location."""
    assert all(error["loc"][0] == "body" for error in errors), errors
    return sorted({f"{error_location(error['loc'][1:])}: {error['type']}" for error in errors})


class Api:
    """The dashboard's app, with its calculation replaced by one that
    counts its calls; open, its lifespan has started, as in the server."""

    def __init__(self, api, household_impact):
        from fastapi.testclient import TestClient

        self.api = api
        self.calls = 0

        def calculate(*args, **kwargs):
            self.calls += 1
            return {}

        household_impact.calculate_household_impact = calculate
        self.client = TestClient(api.app)

    def __enter__(self):
        self.client.__enter__()
        return self

    def __exit__(self, *exception):
        self.client.__exit__(*exception)

    def verdict(self, body) -> dict:
        """The API's verdict on the body, sent as JSON: accepted, or the
        errors FastAPI reports. A 422 whose errors hold an unpaired
        surrogate cannot be written as UTF-8, so the API answers 500
        instead; so it does when a validator's message holds one, which
        pydantic-core raises on before it reports anything."""
        from fastapi.exceptions import RequestValidationError

        text = json.dumps(body, allow_nan=False)
        # Answers are kept by request: a repeated one would not reach the
        # calculation
        self.api._cached_household_impact.cache_clear()
        calls = self.calls
        try:
            response = self.client.post(ROUTE, content=text, headers={"content-type": "application/json"})
        except UnicodeEncodeError as error:
            assert holds_lone_surrogate(body) and self.calls == calls, text
            if isinstance(error.__context__, RequestValidationError):
                return {"accepted": False, "errors": reported(error.__context__.errors()), "status": 500}
            return {"accepted": False, "errors": [], "status": 500}
        if response.status_code == 200:
            assert self.calls == calls + 1, f"Accepted without reaching the calculation: {text}"
            return {"accepted": True, "errors": []}
        assert self.calls == calls, text
        assert response.status_code == 422, (
            f"{response.status_code} for {text}: {response.text[:300]}. The mirror covers FastAPI's validation only"
        )
        return {"accepted": False, "errors": reported(response.json()["detail"])}


def capture(dashboard: Path, commit: str, source: Path, out: Path):
    check_interpreter()
    check_bytecode()
    tracked = check_source(dashboard, commit, source)
    environment, checked = check_environment(dashboard, commit, source)
    opened = Opened()
    import uk_budget_data
    from fastapi.routing import APIRoute
    from uk_budget_data import api, household_impact

    package = (source / "src" / "uk_budget_data" / "__init__.py").resolve()
    assert Path(uk_budget_data.__file__).resolve() == package, f"uk_budget_data is not {source}'s"

    routes = [route for route in api.app.routes if isinstance(route, APIRoute) and route.path == ROUTE]
    assert len(routes) == 1 and routes[0].methods == {"POST"}, routes
    (body,) = routes[0].dependant.body_params
    model = body.field_info.annotation
    schema = validation_schema(model.model_json_schema())
    features, functions, models = core_schema_features(model.__pydantic_core_schema__)
    validators, namespace, validator_functions = validator_code(models, functions)

    # What the validators read, as they read it: the policy years and the
    # measures (the mirror copies their code, so the names they read are
    # the ones recorded here)
    def read():
        return {
            "policy_years": list(namespace["POLICY_YEARS"]),
            "measure_ids": list(namespace["household_impact"].measure_ids()),
        }

    choices = {**read(), **schema_choices(schema)}
    base = copy.deepcopy(DASHBOARD_REQUESTS["defaults"])
    base["policies"] = choices["measure_ids"][:2]
    base["include"] = list(choices["parts"])
    base["household"]["children"] = [{"age": 4}, {"age": 17, "in_education": True}]

    with DashboardCode(source, tracked, skip=validator_functions) as ran, Api(api, household_impact) as client:
        assert client.verdict(base)["accepted"], "The base body must be one the API accepts"
        cases = []
        for case in cases_for(model, base, choices):
            case = json_number(case)
            cases.append({**case, **client.verdict(apply(base, case))})
    assert {name: choices[name] for name in ("policy_years", "measure_ids")} == read(), "The choices changed"
    code = ran.record()
    files = dashboard_files(tracked, source, opened)
    check_loaded(tracked, checked)
    check_opened(tracked, checked, opened)
    check_bytecode()

    header = {
        "_note": (
            "What the Autumn Budget 2026 dashboard's household impact API accepts: its own app, run at the "
            "commit with its calculation replaced, posted each case. Written by "
            "capture_household_impact_api.py; regenerate with it rather than editing by hand."
        ),
        "source": {
            "dashboard": "PolicyEngine/uk-autumn-budget-dashboard-2026",
            "commit": commit,
            "seed": SEED,
        },
        # One package a line, so a recapture's diff reads
        "environment": json.dumps(environment, indent=1, ensure_ascii=False).replace("\n", "\n "),
        "choices": {name: json.dumps(value, ensure_ascii=False) for name, value in choices.items()},
        "schema": json.dumps(schema, ensure_ascii=False),
        "validators": json.dumps(validators, ensure_ascii=False),
        "features": json.dumps(features, ensure_ascii=False),
        "code": json.dumps(code, ensure_ascii=False),
        "files": json.dumps(files, ensure_ascii=False),
        "base": json.dumps(base, ensure_ascii=False),
    }
    # One choice list and one case a line, so a recapture's diff reads
    lines = ["{"]
    lines += [f' "{key}": {json.dumps(header[key], ensure_ascii=False)},' for key in ("_note", "source")]
    lines.append(' "choices": {')
    lines += [f'  "{name}": {value},' for name, value in header["choices"].items()]
    lines[-1] = lines[-1].rstrip(",")
    lines.append(" },")
    keys = ("environment", "schema", "validators", "features", "code", "files", "base")
    lines += [f' "{key}": {header[key]},' for key in keys]
    lines.append(' "cases": [')
    # ASCII, so an unpaired surrogate is written as its escape
    lines += [f"  {json.dumps(case)}," for case in cases]
    lines[-1] = lines[-1].rstrip(",")
    lines += [" ]", "}"]
    out.write_text("\n".join(lines) + "\n")
    assert json.loads(out.read_text())["cases"] == cases
    accepted = sum(case["accepted"] for case in cases)
    print(f"Wrote {out.name}: {len(cases)} cases, {accepted} accepted")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dashboard", type=Path, required=True, help="a clone of the dashboard")
    parser.add_argument("--commit", required=True, help="the dashboard commit to capture")
    parser.add_argument("--source", type=Path, help="an export of the commit made before")
    parser.add_argument("--python", help="the interpreter of an environment synced to the export's uv.lock")
    parser.add_argument("--output", type=Path, default=OUT, help="where to write the fixture")
    parser.add_argument("--inner", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    check_interpreter()
    dashboard = args.dashboard.expanduser().resolve()
    commit = resolve_commit(dashboard, args.commit)
    out = args.output.expanduser().resolve()
    if args.inner:
        return capture(dashboard, commit, args.source, out)

    with tempfile.TemporaryDirectory() as temporary, tempfile.TemporaryDirectory() as cache:
        source = args.source.expanduser().resolve() if args.source else Path(temporary)
        if not args.source:
            export(dashboard, commit, source)
        python = [args.python] if args.python else ["uv", "run", "--frozen", "--exact", "--project", str(source), "python"]
        # One interpreter mode whatever the shell sets: no cached bytecode
        # read or written, so every module runs from its source; UTF-8 mode
        # whatever the locale; and no PYTHON* setting but PYTHONPATH, which
        # an export of a changed commit needs (the environment records the
        # flags that result)
        python += ["-B", "-X", "utf8", "-X", f"pycache_prefix={cache}"]
        env = {key: value for key, value in os.environ.items() if not key.startswith("PYTHON") or key == "PYTHONPATH"}
        inner = [__file__, "--inner", "--dashboard", str(dashboard), "--commit", commit, "--source", str(source)]
        inner += ["--output", str(out)]
        sys.exit(subprocess.run([*python, *inner], env=env).returncode)


if __name__ == "__main__":
    main()
