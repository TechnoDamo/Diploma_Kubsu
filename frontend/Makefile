SHELL := /bin/zsh

.PHONY: help setup install init-mock dev mock build typecheck clean

help:
	@echo "Frontend commands:"
	@echo "  make setup      - install deps + init MSW worker"
	@echo "  make install    - install npm dependencies"
	@echo "  make init-mock  - generate MSW service worker file"
	@echo "  make dev        - run Vite dev server (real API)"
	@echo "  make mock       - run Vite dev server in mock mode"
	@echo "  make typecheck  - run TypeScript type-check"
	@echo "  make build      - build production bundle"
	@echo "  make clean      - remove local build/dependency artifacts"

setup: install init-mock

install:
	npm install

init-mock:
	npx msw init public --save

dev:
	npm run dev

mock:
	npm run mock

typecheck:
	npm run typecheck

build:
	npm run build

clean:
	rm -rf node_modules dist package-lock.json
