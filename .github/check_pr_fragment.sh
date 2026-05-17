#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${GITHUB_BASE_REF:-main}"
BASE_REMOTE="origin/${BASE_REF}"

if ! git rev-parse --verify --quiet "$BASE_REMOTE" >/dev/null; then
  git fetch --no-tags --depth=1 origin "$BASE_REF"
fi

FRAGMENTS=$(
  git diff --name-only --diff-filter=AM "$BASE_REMOTE"...HEAD -- 'changelog.d/*.md' \
    | grep -E '\.(added|changed|fixed|removed|breaking)\.md$' \
    || true
)

if [ -z "$FRAGMENTS" ]; then
  echo "::error::No valid changelog fragment found in changelog.d/."
  echo "Add a fragment: echo 'Your change description' > changelog.d/<name>.<type>.md"
  echo "Valid types: added, changed, fixed, removed, breaking"
  exit 1
fi

echo "Found changelog fragment(s):"
echo "$FRAGMENTS"
