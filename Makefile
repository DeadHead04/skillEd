.PHONY: build test test-action verify fmt-check hooks package package-plugins docs e2e
build:
	npm run build
verify:
	npm run verify
fmt-check:
	git diff --check
test: build
	npm test
test-action: build
	npm run test:action
e2e:
	npm run gate -- --phase=5
hooks:
	git config core.hooksPath .githooks
package:
	npm run release:build
package-plugins: build
	npm run package:plugins
docs:
	npm run docs:build
