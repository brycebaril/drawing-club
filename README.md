# Life Drawing Society Scheduling System

A scheduling and membership platform for a life drawing society — see `docs/DesignDocument.md` for the full product spec.

## Docs

Read these before working on the code — they're the source of truth, not this README:

- `docs/DesignDocument.md` — business logic, roles, the pass/booking economy, payments, draft data models.
- `docs/SiteOutline.md` — route map, RBAC visibility, modal/deep-linking architecture.
- `docs/ArchitectureDocument.md` — stack, infrastructure, local development setup, testing strategy.
- `docs/SecurityDocument.md` — auth/session security, RBAC enforcement, secrets, compliance.
- `docs/MigrationPlan.md` — one-time legacy data cutover plan.
- `CLAUDE.md` — condensed orientation and non-obvious domain rules for anyone (human or AI) picking up this repo.

## Quick start

```bash
docker compose up -d      # local Postgres
pnpm install
pnpm migrate               # apply schema
pnpm seed                  # optional: sample data
pnpm dev                   # http://localhost:3000
```

Full local dev setup (env vars, Stripe CLI webhook forwarding, seeding) is documented in `docs/ArchitectureDocument.md` §5.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Run the app locally |
| `pnpm build` / `pnpm start` | Production build / run |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm migrate` / `pnpm migrate:down` | Apply / roll back the latest database migration |
| `pnpm seed` | Seed local Postgres with sample data |
| `pnpm test` | Unit/integration tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests (Playwright) |
