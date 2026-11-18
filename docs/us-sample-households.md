# US sample households

The catalog supplies editable examples from PolicyEngine's calibrated synthetic population. It contains 32 sample slots for each of the 50 states and DC. PolicyEngine 6.20.2 certifies the 2024 national population, `populace_us_2024`, build `populace-us-2024-spm-20260915`. The publisher distributes the population publicly under the MIT license. [Certified bundle](https://github.com/PolicyEngine/policyengine.py/blob/47d1d8bf5ed7a37d2375f38378d99fde68ab4fe7/src/policyengine/data/bundle/manifest.json) · [Dataset and license](https://huggingface.co/datasets/policyengine/populace-us/blob/0ff35303e4e5c10bf1cfb2da8f65c83d7dfa9ab3/README.md)

## Inputs and coverage

The generator starts with the release's calibrated household weights and preserves observed membership in the synthetic population's tax units, families, SPM units and marital units. Each eligible household has one tax unit, one family and one SPM unit. It has one head aged 18 or older, optionally a spouse aged 18 or older, and up to six dependents aged 0–23, each in their own marital unit. The source identifies dependents by tax role, including dependents aged 18–23. The household's composition must yield its source filing status of single, head of household or joint. The filter accepts eligible households from both the ASEC and PUF tax-detail support channels.

Of 57,240 source household records with positive weight, 39,337 meet the selection criteria. Their calibrated weights sum to 85.63 million out of 122.54 million weighted households in this release (69.88%). The national draw represents this eligible population. A state draw represents the eligible households assigned to that state in the national release.

Each profile carries state, marital status and each member's age, role, employment income, net self-employment income, retirement Social Security and taxable private pension income. The generator reads `employment_income_before_lsr`, `self_employment_income_before_lsr`, `social_security_retirement` and `taxable_private_pension_income` from the person table and rounds to the nearest dollar. It retains losses in net self-employment income and omits optional amounts that round to zero. These amounts represent nominal annual dollars in 2024. Applying another year's policy holds the sampled ages and incomes fixed unless the user edits them.

Profiles omit other income, expenses, assets, ZIP, county and program participation. Source identifiers stay in the generation step. The compact profiles capture a subset of the information in the source household, so a calculation on one can differ from the source household's modeled results.

## Drawing a profile

Within each state the generator draws 32 times with replacement, in proportion to eligible household weights. The seed incorporates the state code. Each slot within a state then carries an equal share of its state's total eligible weight. On an initial national draw, states enter in proportion to their total eligible weights. An initial state draw selects a slot uniformly. A reroll can exclude the previous profile when another profile exists. The finite catalog can include repeated profiles and can miss uncommon household types.

## Regenerating the catalog

Download the pinned artifact (about 789 MiB) or use a cached copy. The generator verifies its SHA-256 against the certified bundle before reading it. Run these commands from the repository root.

```sh
curl -fL -o /tmp/populace_us_2024.h5 \
  https://huggingface.co/datasets/policyengine/populace-us/resolve/0ff35303e4e5c10bf1cfb2da8f65c83d7dfa9ab3/releases/microcosm-us-2024-national/populace-us-2024-spm-20260915/populace_us_2024.h5
uv run --python 3.12 scripts/generate-us-samples.py /tmp/populace_us_2024.h5
```

Run the offline generator tests with a small fixture.

```sh
uv run --no-project --python 3.12 --with h5py==3.16.0 python -m unittest discover -s tests/us-household -p test_generate_us_samples.py
```
