.PHONY: install test build typecheck

install:
	bun install

test:
	bun run test

build:
	bun run build

typecheck:
	bun run typecheck

regenerate-counties:
	bun run regenerate-counties
