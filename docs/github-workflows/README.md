# GitHub Workflows (manual install)

The automation token used to push this repository does **not** have the
GitHub `workflow` scope, so workflow files cannot be committed directly
under `.github/workflows/`. They are staged here instead.

## Install CI

1. Copy `ci.yml` from this folder to `.github/workflows/ci.yml`
   (e.g. via the GitHub web UI: **Add file → Create new file**, name it
   `.github/workflows/ci.yml`, paste the contents, commit).
2. The workflow then runs on every pull request and every push to
   `main`: checkout → Node 24 → `npm ci` → `npm run lint` → `npm test`.

Notes:

- `package.json` has no `engines` field, so the workflow pins Node 24
  (the version the production Docker image uses). Tests use
  `mongodb-memory-server`, so no MongoDB service container is needed.
- `npm run lint` is a real ESLint run (flat config, QOL-02) and is
  allowed to fail the build — it is not the old `|| true` stub.

## Commit message convention (QOL-10 prep)

This repo uses [Conventional Commits](https://www.conventionalcommits.org/),
validated by [commitlint](https://commitlint.js.org/) with
`@commitlint/config-conventional` (see `commitlint.config.js` at the
repo root):

```
<type>(<optional scope>): <short imperative summary>

types: feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert
```

Examples:

- `feat(orders): add buyer analytics summary`
- `fix(auth): reject body-supplied refresh tokens`
- `chore(deps): bump mongoose to 8.13`

The config is provided for editors/CI use; no local git hooks are
installed by default (husky is intentionally not wired up), so nothing
runs during `npm test`. To check a message manually:

```
npx commitlint --from HEAD~1 --to HEAD
```
