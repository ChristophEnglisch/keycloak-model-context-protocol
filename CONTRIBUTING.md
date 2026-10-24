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
5. Document the tool and its parameters in the README.

Implementation details are in the code and its existing tools; follow their patterns.

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
