# /// script
# requires-python = ">=3.12"
# dependencies = ["h5py==3.16.0"]
# ///
"""Build the sample catalog from a verified population HDF5, using one process.

uv run scripts/generate-us-samples.py /path/to/populace_us_2024.h5
See docs/us-sample-households.md for the release and sampling design.
"""

import argparse
import hashlib
import json
import math
import random
from collections import defaultdict
from pathlib import Path

import h5py

BUILD = "populace-us-2024-spm-20260915"
REVISION = "0ff35303e4e5c10bf1cfb2da8f65c83d7dfa9ab3"
SHA256 = "6496cc4393d4d3c6574f76eca231de5898c803b9067645591fd5c4d3e65aee84"
SOURCE = f"https://huggingface.co/datasets/policyengine/populace-us/blob/{REVISION}/README.md"
YEAR = 2024
SLOTS = 32
SEED = 20261118
OUT = Path(__file__).resolve().parents[1] / "src/us-household/samples/catalog.json"

# State and DC FIPS codes in Census order (territories excluded).
FIPS = dict(
    zip(
        (
            1,
            2,
            4,
            5,
            6,
            8,
            9,
            10,
            11,
            12,
            13,
            15,
            16,
            17,
            18,
            19,
            20,
            21,
            22,
            23,
            24,
            25,
            26,
            27,
            28,
            29,
            30,
            31,
            32,
            33,
            34,
            35,
            36,
            37,
            38,
            39,
            40,
            41,
            42,
            44,
            45,
            46,
            47,
            48,
            49,
            50,
            51,
            53,
            54,
            55,
            56,
        ),
        "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(),
        strict=True,
    )
)

INCOMES = {
    "employmentIncome": "employment_income_before_lsr",
    "selfEmploymentIncome": "self_employment_income_before_lsr",
    "socialSecurityIncome": "social_security_retirement",
    "privatePensionIncome": "taxable_private_pension_income",
}
ROLE_ORDER = {b"HEAD": 0, b"SPOUSE": 1, b"DEPENDENT": 2}


def project(members, filing):
    """Return a projection only when the wizard preserves membership and filing."""
    for column in ("person_tax_unit_id", "person_family_id", "person_spm_unit_id"):
        if len({p[column] for p in members}) != 1:
            return None
    if any(p["tax_unit_role_input"] not in ROLE_ORDER for p in members):
        return None
    people = sorted(members, key=lambda p: ROLE_ORDER[p["tax_unit_role_input"]])
    roles = [p["tax_unit_role_input"] for p in people]
    heads, spouses, deps = (roles.count(role) for role in ROLE_ORDER)
    if heads != 1 or spouses > 1 or deps > 6:
        return None
    expected = b"JOINT" if spouses else (b"HEAD_OF_HOUSEHOLD" if deps else b"SINGLE")
    if filing != expected:
        return None
    adult_units = {p["person_marital_unit_id"] for p in people[: 1 + spouses]}
    all_units = {p["person_marital_unit_id"] for p in people}
    if len(adult_units) != 1 or len(all_units) != deps + 1:
        return None

    projected = []
    for p in people:
        adult = p["tax_unit_role_input"] != b"DEPENDENT"
        age = float(p["age"])
        if not age.is_integer() or not (18 if adult else 0) <= age <= 120:
            return None
        person = {"kind": "adult" if adult else "dependent", "age": int(age)}
        for field, column in INCOMES.items():
            value = float(p[column])
            if not math.isfinite(value) or (field == "employmentIncome" and value < 0):
                return None
            dollars = round(value)
            if dollars or field == "employmentIncome":
                person[field] = dollars
        projected.append(person)
    return {"maritalStatus": "married" if spouses else "single", "people": projected}


def build(path):
    with path.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != SHA256:
            raise ValueError("HDF5 checksum does not match the certified bundle")
    with h5py.File(path) as data:
        if data["_time_period/table"].fields("values")[:].tolist() != [YEAR]:
            raise ValueError("Unexpected source year")
        member_columns = [
            "person_household_id",
            "person_tax_unit_id",
            "person_family_id",
            "person_marital_unit_id",
            "person_spm_unit_id",
            "tax_unit_role_input",
            "age",
            *INCOMES.values(),
        ]
        memberships = defaultdict(list)
        for p in data["person/table"].fields(member_columns)[:]:
            memberships[p["person_household_id"]].append(p)
        tax_units = dict(
            data["tax_unit/table"].fields(["tax_unit_id", "filing_status_input"])[:]
        )
        households = data["household/table"].fields(
            ["household_id", "household_weight", "state_fips"]
        )[:]

    eligible = defaultdict(list)
    for household_id, weight, fips in households:
        if not math.isfinite(weight) or weight < 0:
            raise ValueError("Invalid calibrated household weight")
        if weight == 0:
            continue
        members = memberships[household_id]
        if not members:
            raise ValueError("No people for a source household")
        profile = project(members, tax_units[members[0]["person_tax_unit_id"]])
        if profile is not None:
            eligible[FIPS[fips]].append((float(weight), profile))

    states = {}
    for state in sorted(FIPS.values()):
        weights, profiles = zip(*eligible[state], strict=True)
        rng = random.Random(f"{SEED}:{state}")
        states[state] = {
            "populationWeight": math.fsum(weights),
            "households": rng.choices(profiles, weights=weights, k=SLOTS),
        }
    return {
        "provenance": {
            "dataset": "populace_us_2024",
            "buildId": BUILD,
            "year": YEAR,
            "url": SOURCE,
            "sha256": SHA256,
            "policyengineVersion": "6.20.2",
            "drawsPerState": SLOTS,
            "seed": SEED,
        },
        "states": states,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    result = build(args.source)
    args.output.write_text(
        json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n"
    )
