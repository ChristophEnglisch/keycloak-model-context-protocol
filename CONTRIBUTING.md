# Contributing

Thanks for your interest in improving `keycloak-model-context-protocol`. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. Security issues: see [SECURITY.md](SECURITY.md).

## Setup

Requirements: Node.js 22+ (see `.nvmrc`), npm, Docker (for integration tests).

```bash
git clone https://github.com/ChristophEnglisch/keycloak-model-context-protocol.git
cd keycloak-model-context-protocol
nvm use        # optional
npm ci
cp .env.example .env   # only for manual runs against your own Keycloak
```

## Scripts

| Script                     | Purpose                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `npm run lint`             | Biome lint and format check                                       |
| `npm run typecheck`        | TypeScript type check                                             |
| `npm test`                 | Unit tests (Vitest)                                               |
| `npm run test:integration` | Integration tests against a real Keycloak (Docker/Testcontainers) |
| `npm run build`            | Compile to `dist/`                                                |

Run lint, typecheck, test and build before opening a PR.

CI (`.github/workflows/ci.yml`) only runs the jobs a change affects: a docs-only PR runs no tests, a change under `tests/unit/` runs lint and unit tests, a change under `src/` or to the dependencies runs everything. The mapping lives in the `changes` job; paths it does not know trigger a full run. The `CI result` check summarises all jobs. The compatibility probes against older Keycloak versions (24.0, 25.0) are allowed to fail and run only on `main`, in the weekly run and on manual runs, not on pull requests.

## Test levels

- **Unit** (`tests/unit/`): fast, no network, Keycloak client mocked.
- **Integration** (`tests/integration/`): start a Keycloak container via Testcontainers; Docker must be running.

New behavior needs tests. Bug fixes need a regression test.

## Commits and pull requests

We use [Conventional Commits](https://www.conventionalcommits.org/). PR titles must follow the same format, as they drive the changelog and version bump.
- `feat:` new functionality (minor)
- `fix:` bug fix (patch)
- `docs:`, `chore:`, `test:`, `refactor:`, `ci:` no release impact on their own
- `!` after the type (e.g. `feat!:`) or a `BREAKING CHANGE:` footer marks a breaking change (major)

## Adding a new tool

1. Create or extend a file under `src/tools/<domain>.ts` and register it in the matching toolset.
2. Set annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) accurately; read-only mode and confirmation depend on them.
3. Define an input schema and an `outputSchema` (zod) and return `structuredContent`.
4. Add a unit test under `tests/unit/tools/`.
5. Regenerate the tool reference with `npm run docs:tools` (`docs/tools-reference.md` is generated, do not edit it by hand). The steps in detail: [docs/architecture.md](docs/architecture.md).

Implementation details are in the code and its existing tools; follow their patterns.

## Releases

Releases are cut by [release-please](https://github.com/googleapis/release-please) from the Conventional Commit titles merged into `main`. It opens a release pull request with the changelog and version bump; merging it tags the release, publishes to npm with [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) and a provenance attestation, and updates the entry in the [MCP Registry](https://registry.modelcontextprotocol.io). Contributors do not need to do anything beyond using the right commit title. A faulty release is deprecated on npm and followed by a patch release, never unpublished.

## Dependency updates

[Renovate](https://docs.renovatebot.com/) keeps dependencies, GitHub Actions and the newest tested Keycloak version current ([`renovate.json`](renovate.json)). It opens pull requests on Monday mornings for releases at least three days old; security fixes come right away. Minor, patch and digest updates and the weekly lockfile refresh merge themselves once CI is green. Major updates and a new Keycloak minor wait for a review. Runtime dependency updates use the `deps:` commit type, which appears in the changelog and triggers a patch release. `@types/node` stays on the oldest supported Node major. The "Dependency Dashboard" issue lists pending and held-back updates.

## Versioning policy (Semver)

The public API consists of:
- tool names, parameters and output schemas
- environment variables and their semantics
- the CLI/binary name
- supported Node.js and Keycloak versions

Breaking changes to any of these require a new major version. New tools, optional parameters and additional output fields are minor changes. Internal TypeScript modules are not public API (the package ships a CLI, not a library).

### Deprecation policy

Deprecated features keep working and emit a warning (stderr log and, where applicable, in the tool description) for at least one minor release before they are removed in the next major release. Deprecations are listed in the changelog.

## Reporting bugs and requesting features

Use the issue templates. Never include secrets, tokens or real user data.
