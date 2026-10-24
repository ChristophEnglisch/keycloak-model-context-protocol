# Release-Prozess

Releases laufen vollautomatisch über [release-please](https://github.com/googleapis/release-please-action) und npm Trusted Publishing (OIDC). Es gibt kein `NPM_TOKEN` mehr. Jede veröffentlichte Version trägt eine Provenance-Attestierung.

Beteiligte Dateien:

| Datei | Zweck |
|---|---|
| `.github/workflows/ci.yml` | Qualitätsprüfung bei Push auf `main` und bei Pull Requests |
| `.github/workflows/release.yml` | release-please, npm-Publish, MCP-Registry-Publish |
| `release-please-config.json` | Release-Konfiguration (Changelog-Sektionen, `extra-files`, `release-as`) |
| `.release-please-manifest.json` | Aktuell veröffentlichte Version (Startwert `0.0.2`) |
| `server.json` | Metadaten für die offizielle MCP Registry (Version wird von release-please mitgezogen) |

## Ablauf

```mermaid
flowchart TD
    A["PR mit Conventional-Commit-Titel<br/>(feat:, fix:, feat!: ...)"] --> B{"ci.yml grün?<br/>lint · typecheck · unit (Node 22/24/26)<br/>integration (Keycloak 26.0/26.8)<br/>build + pack-smoke · npm audit"}
    B -- nein --> A
    B -- ja --> C["Squash-Merge nach main"]
    C --> D["release.yml: release-please<br/>Release-PR anlegen/aktualisieren<br/>CHANGELOG.md · package.json · server.json"]
    D --> E{"Maintainer merged<br/>den Release-PR?"}
    E -- noch nicht --> C
    E -- ja --> F["Tag vX.Y.Z + GitHub Release"]
    F --> G["Job publish-npm (environment: release)<br/>Tag auschecken · npm ci · build · test"]
    G --> H["npm publish --provenance<br/>Trusted Publishing (OIDC), kein Token"]
    H --> I["Job publish-mcp-registry<br/>mcp-publisher login github-oidc<br/>mcp-publisher publish"]
    I --> J([Release verfügbar:<br/>npm · MCP Registry])
    J --> K{Problem im Release?}
    K -- ja --> L["npm deprecate pkg@X.Y.Z 'Grund'<br/>+ fix:-Patch-Release (kein unpublish)"]
    K -- nein --> M([Fertig])
```

Hinweise:

- Der Release-PR wird mit dem `GITHUB_TOKEN` angelegt. GitHub startet für solche PRs **keine** weiteren Workflows, `ci.yml` läuft dort also nicht automatisch. Da der Release-PR nur Version, Changelog und `server.json` ändert und der Publish-Job vor dem Veröffentlichen selbst `build` und `test` ausführt, ist das akzeptabel. Wer die Checks auch am Release-PR will, schließt ihn einmal und öffnet ihn wieder, oder stellt release-please auf ein PAT bzw. eine GitHub App um.
- Der MCP-Registry-Job läuft nur, wenn der npm-Publish erfolgreich war. Schlägt er fehl, kann er unabhängig wiederholt werden (Re-run des Jobs), die npm-Version bleibt bestehen.

## Einmalige Einrichtung (durch den Repo-Owner)

1. **npm Trusted Publisher konfigurieren.** Auf npmjs.com: Paket `keycloak-model-context-protocol` → *Settings* → *Trusted Publisher* → *GitHub Actions*. Einzutragen:
   - Organization/User: `ChristophEnglisch`
   - Repository: `keycloak-model-context-protocol`
   - Workflow filename: `release.yml`
   - Environment name: `release`
2. **GitHub-Environment `release` anlegen** (*Settings → Environments*). Empfohlen: Required reviewers (der Owner), Deployment branches/tags auf `main` bzw. `v*` beschränken. Beide Publish-Jobs verwenden dieses Environment, jeder Publish wartet also auf eine Freigabe.
3. **Workflow-Berechtigung für release-please:** *Settings → Actions → General → Workflow permissions* auf „Read and write permissions“ setzen und „Allow GitHub Actions to create and approve pull requests“ aktivieren. Ohne das kann release-please keinen Release-PR anlegen.
4. **Token-Publishing sperren.** Erst nachdem der erste Trusted-Publishing-Release (1.0.0) erfolgreich war: npmjs.com → Paket → *Settings → Publishing access* → „Require two-factor authentication and disallow tokens“. Danach alle bestehenden Automation-Tokens des Pakets widerrufen.
5. **Altes Secret löschen:** GitHub → *Settings → Secrets and variables → Actions* → `NPM_TOKEN` entfernen.
6. **Private Vulnerability Reporting aktivieren:** *Settings → Code security → Private vulnerability reporting* einschalten (Voraussetzung für den Meldeweg in `SECURITY.md`).
7. **MCP Registry:** Das Feld `mcpName` in `package.json` muss `io.github.christophenglisch/keycloak-model-context-protocol` lauten und dem `name` in `server.json` entsprechen. Der Login erfolgt per GitHub-OIDC, es ist kein Secret nötig. Der Namespace `io.github.<user>/` wird gegen den GitHub-Besitzer des Repos geprüft. Falls die Registry die Groß-/Kleinschreibung (`ChristophEnglisch`) beanstandet, den Namen in `server.json` und `mcpName` entsprechend anpassen. Das lässt sich ohne Veröffentlichung nicht vorab prüfen.
8. Optional: Branch Protection für `main` mit den Checks aus `ci.yml` (`lint-typecheck`, `unit`, `integration`, `build-smoke`, `audit`) als Pflicht. Die Integration-Zeilen für Keycloak 24.0 und 25.0 sind bewusst `continue-on-error` und sollten **nicht** als Pflicht-Check gesetzt werden.

## 1.0.0 schneiden

Der erste Release soll exakt `1.0.0` heißen, unabhängig von den bisherigen Commits. Dafür steht in `release-please-config.json` unter `packages["."]` der Schlüssel `"release-as": "1.0.0"`.

1. Sicherstellen, dass alle Änderungen für 1.0 auf `main` gemergt sind und `ci.yml` grün ist (die Commits müssen Conventional-Commit-Titel haben, sonst fehlen sie im Changelog).
2. Warten, bis release-please den PR „chore(main): release 1.0.0“ anlegt. Changelog, `package.json` und `server.json` prüfen.
3. Release-PR mergen. Tag `v1.0.0` und GitHub Release entstehen, danach läuft `publish-npm` (ggf. nach Freigabe im Environment `release`) und anschließend `publish-mcp-registry`.
4. Prüfen: `npm view keycloak-model-context-protocol version dist.attestations` und die Suche in der MCP Registry.
5. **Wichtig: `"release-as": "1.0.0"` direkt nach dem Release wieder aus `release-please-config.json` entfernen** (eigener `chore:`-Commit auf `main`). JSON erlaubt keine Kommentare, daher steht die Warnung hier. Bleibt der Schlüssel stehen, schlägt release-please jedes Mal erneut `1.0.0` vor und weitere Releases scheitern. Außerdem das Manifest `.release-please-manifest.json` nicht von Hand ändern, release-please setzt es auf `1.0.0`.
6. Danach Schritt 4 der Einrichtung durchführen (Token-Publishing sperren, `NPM_TOKEN` löschen).

## Conventional Commits und Versionen

release-please leitet die nächste Version aus den Commit-Titeln seit dem letzten Release ab (bei Squash-Merge ist das der PR-Titel):

| Commit-Typ | Wirkung ab 1.0 | Changelog-Sektion |
|---|---|---|
| `fix:` | Patch (1.0.0 → 1.0.1) | Bug Fixes |
| `feat:` | Minor (1.0.0 → 1.1.0) | Features |
| `feat!:` / `fix!:` oder Footer `BREAKING CHANGE:` | Major (1.x → 2.0.0) | Hervorgehoben im Changelog |
| `perf:` | Patch | Performance Improvements |
| `docs:` | Patch | Documentation |
| `deps:` | Patch | Dependencies |
| `chore:`, `refactor:`, `test:`, `ci:`, `build:` | kein Release | im Changelog ausgeblendet |

Als Breaking Change gilt bei diesem Projekt alles, was bestehende MCP-Clients bzw. Konfigurationen bricht: Umbenennen oder Entfernen von Tools, Parametern, Env-Variablen oder Defaults sowie Änderungen am Format der `structuredContent`-Ausgabe. Neue Tools oder optionale Parameter sind `feat:`.

Hinweis: `chore:`/`ci:`-Commits allein lösen keinen Release-PR aus. Abhängigkeits-Updates, die das veröffentlichte Paket betreffen, sollten als `deps:` (oder `fix(deps):`) eingereicht werden. Die Dependabot-Konfiguration dafür ist nicht Teil dieser Datei.

## Fehlerbehebung

- **Kein Release-PR erscheint:** Seit dem letzten Release gab es keine Commits vom Typ `feat`, `fix`, `perf`, `docs` oder `deps`, oder Workflow-Berechtigungen fehlen (Einrichtung, Schritt 3).
- **`npm publish` meldet 404/E403 oder „Unable to authenticate“:** Der Trusted Publisher stimmt nicht exakt mit Repo, Workflow-Datei `release.yml` und Environment `release` überein (Einrichtung, Schritt 1). Der Workflow darf nicht umbenannt werden.
- **npm-Version:** Trusted Publishing braucht npm ≥ 11.5.1. Node 24 liefert in aktuellen Patch-Releases npm 11.x mit. Der Workflow prüft die Version trotzdem und führt bei Bedarf `npm install -g npm@latest` aus.
- **Fehlerhaftes Release:** Nie `npm unpublish`. Stattdessen `npm deprecate keycloak-model-context-protocol@X.Y.Z "Grund"` und einen `fix:`-Patch-Release nachschieben.
