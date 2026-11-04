# Publish a release

The main-push workflow bumps the version from changelog fragments, builds the
changelog and package, publishes to npm, then commits the release changes. Its
`Release policyengine-household-wizard` commit skips the next release run.

## Configure npm trusted publishing

The npm package's **Settings → Trusted publishing** must contain this GitHub
Actions publisher before a release runs:

| Field | Value |
| --- | --- |
| Organization | `PolicyEngine` |
| Repository | `policyengine-household-wizard` |
| Workflow filename | `push.yml` |
| Environment | Leave empty; the release job has no environment |
| Allowed action | Enable direct `npm publish` |

Use the filename alone, including its extension. New publisher configurations
default to staged publishing; explicitly allow direct publishing for this
workflow. Package-side configuration and workflow OIDC permissions are both
required. The release uses GitHub-hosted runners and needs no `NPM_TOKEN` or
`NODE_AUTH_TOKEN`. See [npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

With an authenticated npm CLI that supports `npm trust`, inspect the existing
mapping before adding one:

```bash
npm trust list policyengine-household-wizard
```

If that mapping is absent, configure it through package settings or the CLI:

```bash
npm trust github policyengine-household-wizard \
  --repo PolicyEngine/policyengine-household-wizard \
  --file push.yml \
  --allow-publish
```

Trust configuration requires package write access, account two-factor
authentication, and npm 11.15.0 or newer. Granular tokens configured to bypass
two-factor authentication cannot manage trust. See the
[`npm trust` reference](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Publishing toolchain

The workflow pins Node **24.22.2** and checks its bundled npm **11.19.1** before
publishing. These versions were verified on November 4, 2026 against the
[official Node distribution index](https://nodejs.org/dist/index.json) and
[npm's version metadata](https://registry.npmjs.org/npm/11.19.1). They meet npm's
trusted-publishing requirements; a version mismatch stops before publication.

Node.js compiles in its list of trusted certificate authorities, so the pinned
version decides which certificates `npm publish` accepts. Keep it at 24.22.1 or
later: earlier Node 24 releases still trust the eMudhra emSign ECC Root CA - G3,
whose intermediate CA keys were compromised in October 2026
(<https://emudhra.we-have-a-problem.com>).

After changing the toolchain, recheck both official sources and update the
version assertions together. Preserve the package's repository URL so npm can
bind provenance to this repository.

## Verify the result

Check the completed publish step and the actual registry version, tarball
integrity, exports, and provenance before upgrading consumers. `npm whoami` and
publish dry runs do not verify an OIDC publication. If publishing succeeds but
the release commit fails, reconcile the repository with that published version;
do not attempt to publish the same version again.
