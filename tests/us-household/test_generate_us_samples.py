"""Offline tests for the public household projection and weighted draws."""

import hashlib
import importlib.util
import math
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "generator", ROOT / "scripts/generate-us-samples.py"
)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def member(role=b"HEAD", age=30, wages=40_000, marital=1):
    return {
        "person_household_id": 1,
        "person_tax_unit_id": 1,
        "person_family_id": 1,
        "person_spm_unit_id": 1,
        "person_marital_unit_id": marital,
        "tax_unit_role_input": role,
        "age": age,
        "is_full_time_college_student": 0,
        "is_disabled": 0,
        "employment_income_before_lsr": wages,
        "self_employment_income_before_lsr": 0,
        "social_security_retirement": 0,
        "taxable_private_pension_income": 0,
    }


class SampleCatalogTest(unittest.TestCase):
    def test_uses_recorded_roles_and_income_components(self):
        head = member(age=40, wages=13_000)
        spouse = member(b"SPOUSE", age=42, wages=14_201.7)
        dependent = member(b"DEPENDENT", age=19, wages=504.1, marital=3)
        head.update(
            self_employment_income_before_lsr=-11.2, taxable_private_pension_income=25.7
        )
        dependent["social_security_retirement"] = 21
        spouse["is_disabled"] = 1
        dependent["is_full_time_college_student"] = 1
        result = generator.project([dependent, spouse, head], b"JOINT")
        self.assertEqual(
            result,
            {
                "maritalStatus": "married",
                "people": [
                    {
                        "kind": "adult",
                        "age": 40,
                        "employmentIncome": 13_000,
                        "selfEmploymentIncome": -11,
                        "privatePensionIncome": 26,
                    },
                    {
                        "kind": "adult",
                        "age": 42,
                        "employmentIncome": 14_202,
                        "isDisabled": True,
                    },
                    {
                        "kind": "dependent",
                        "age": 19,
                        "isFullTimeStudent": True,
                        "employmentIncome": 504,
                        "socialSecurityIncome": 21,
                    },
                ],
            },
        )

    def test_only_unambiguous_memberships_and_supported_values_are_projected(self):
        child = member(b"DEPENDENT", age=7, marital=2)
        with self.assertRaisesRegex(ValueError, "is_disabled"):
            generator.project([{**member(), "is_disabled": 2}], b"SINGLE")
        for column in ("person_tax_unit_id", "person_spm_unit_id", "person_family_id"):
            with self.subTest(column=column):
                self.assertIsNone(
                    generator.project(
                        [member(), {**child, column: 2}], b"HEAD_OF_HOUSEHOLD"
                    )
                )
        self.assertIsNone(
            generator.project([member(), {**child, "age": 24}], b"HEAD_OF_HOUSEHOLD")
        )
        self.assertIsNotNone(
            generator.project([member(), {**child, "age": 23}], b"HEAD_OF_HOUSEHOLD")
        )
        for filing in [b"SINGLE", b"SURVIVING_SPOUSE", b"SEPARATE"]:
            self.assertIsNone(generator.project([member(), child], filing))
        for invalid in [
            member(age=17),
            member(age=math.nan),
            member(wages=-1),
            member(wages=math.nan),
            member(role=b"UNKNOWN"),
        ]:
            self.assertIsNone(generator.project([invalid], b"SINGLE"))
        self.assertIsNone(
            generator.project(
                [member(), {**child, "person_marital_unit_id": 1}], b"HEAD_OF_HOUSEHOLD"
            )
        )
        self.assertIsNone(
            generator.project([member(), member(b"SPOUSE", marital=2)], b"JOINT")
        )
        self.assertIsNone(
            generator.project(
                [member(), *[member(b"DEPENDENT", marital=i + 2) for i in range(7)]],
                b"HEAD_OF_HOUSEHOLD",
            )
        )
        self.assertIsNotNone(generator.project([member(), child], b"HEAD_OF_HOUSEHOLD"))

    def test_reproduces_pps_within_state_and_preserves_eligible_household_weights(self):
        # VA contains two eligible households and one ineligible head under 18.
        # A fourth VA row has zero weight. DC has only one eligible household.
        hids = [40, 30, 20, 10, 50]
        ages = [20, 80, 16, 50, 66]
        weights = [1.0, 5.0, 100.0, 0.0, 10.25]
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "example.h5"
            with h5py.File(source, "w") as data:
                data.create_dataset(
                    "_time_period/table",
                    data=np.array([(2024,)], dtype=[("values", "i8")]),
                )
                data.create_dataset(
                    "household/table",
                    data=np.array(
                        list(zip(hids, weights, [51, 51, 51, 51, 11], strict=True)),
                        dtype=[
                            ("household_id", "i8"),
                            ("household_weight", "f8"),
                            ("state_fips", "i8"),
                        ],
                    ),
                )
                data.create_dataset(
                    "tax_unit/table",
                    data=np.array(
                        [(i, b"SINGLE") for i in hids],
                        dtype=[("tax_unit_id", "i8"), ("filing_status_input", "S20")],
                    ),
                )
                people = []
                for hid, age in zip(hids, ages, strict=True):
                    person = member(age=age)
                    person.update(person_household_id=hid, person_tax_unit_id=hid)
                    people.append(person)
                fields = [
                    (k, "S12" if k == "tax_unit_role_input" else "f8")
                    for k in people[0]
                ]
                data.create_dataset(
                    "person/table",
                    data=np.array(
                        [tuple(p.values()) for p in reversed(people)], dtype=fields
                    ),
                )
            with self.assertRaisesRegex(ValueError, "checksum"):
                generator.build(source)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            with (
                patch.object(generator, "SHA256", digest),
                patch.dict(generator.FIPS, {51: "VA", 11: "DC"}, clear=True),
            ):
                result = generator.build(source)
                self.assertEqual(result, generator.build(source))
        states = result["states"]
        source = result["provenance"]
        self.assertEqual(source["sourceHouseholds"], 4)
        self.assertEqual(source["eligibleHouseholds"], 3)
        self.assertEqual(source["totalWeight"], 116.25)
        self.assertEqual(source["eligibleWeight"], 16.25)
        self.assertEqual(states["VA"]["populationWeight"], 6.0)
        self.assertEqual(states["DC"]["populationWeight"], 10.25)
        self.assertEqual(len(states["DC"]["households"]), generator.SLOTS)
        expected = random.Random(f"{generator.SEED}:VA").choices(
            [20, 80], weights=[1, 5], k=generator.SLOTS
        )
        self.assertEqual(
            [h["people"][0]["age"] for h in states["VA"]["households"]], expected
        )
