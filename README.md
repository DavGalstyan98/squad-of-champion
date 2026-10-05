# Squad of Champions

Fighting-character squad builder with React, Redux Toolkit, TypeScript, NestJS, PostgreSQL and Redis. Characters come from the API; users save named squads of up to six members with server-calculated ability averages.

The original challenge brief is preserved in [frontend/README.md](frontend/README.md). This README covers the backend/fullstack setup and deliverables.

## Run with Docker

Requires Docker Engine/Desktop with BuildKit, Compose v2.20+, internet access and free ports 3000, 3001, 5432 and 6379. From the repository root:

```sh
cp backend/.env.example backend/.env
docker compose up --build
```

| Service  | URL                                 |
| -------- | ----------------------------------- |
| Frontend | http://localhost:3000               |
| API      | http://localhost:3001/api/v1        |
| Swagger  | http://localhost:3001/api/docs      |
| Health   | http://localhost:3001/api/v1/health |

The frontend proxies `/api/`, so API, Swagger and health also work on port 3000. Initialization runs migrations and idempotent seeding before the API starts. A successful `initialize` container exits with code 0; failures prevent API startup. Inspect with `docker compose ps -a` and `docker compose logs initialize`.

This is local development/review configuration with local-only example database credentials. Docker generates a persistent private JWT key when `JWT_SECRET` is blank. PostgreSQL, Redis and JWT keys use named volumes; `docker compose down` retains them. Repeated startup preserves users/squads and does not duplicate characters. Avoid `down -v` when preserving data.

If port 3000 is occupied, stop the React development server. Docker and npm development must not use the same ports simultaneously.

## Local development

Requires Node 22/24 LTS and npm 10/11. Retain existing configured `.env` files rather than overwriting them.

```sh
npm ci
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run config:jwt
docker compose stop frontend api
docker compose up -d --wait postgres redis
npm run migration:run
npm run seed
```

Run `npm run dev:backend` and `npm run dev:frontend` in separate terminals: both are needed, at localhost:3001 and localhost:3000 respectively.

[backend/.env.example](backend/.env.example) documents database/Redis URLs, CORS, JWT claims/expiry, cache TTL and timeouts. Host processes use localhost; Compose supplies container addresses. [frontend/.env.example](frontend/.env.example) sets `REACT_APP_API_URL`; restart the frontend after changing it. Keep credentials out of Git.

## Architecture

```text
frontend/     React + Redux Toolkit/RTK Query, feature-oriented FSD structure
backend/      NestJS auth, users, catalogue, squads, cache and health modules
compose.yaml  PostgreSQL, Redis, migration/seed initializer, API and Nginx frontend
```

TypeORM manages queries and versioned migrations with `synchronize: false`. Simple user operations use query builders; catalogue/squad operations use explicit SQL for batching and transactions. Interfaces have dedicated type files; DTO classes provide validation and Swagger schemas.

Squad writes lock the owner-scoped row with `FOR UPDATE` before reading membership, with bounded waits. Creation/replacement are atomic; repeatable-read snapshots keep read responses coherent. Batched relations prevent N+1 queries: measured detail counts remain 10 HTTP statements for one or six members; lists remain 10 for 1–18 populated squads. `npm run test:squads` prints query counts and local latency conditions/results.

## Database and seeding

| Table                 | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `characters`          | Original integer IDs, character fields and source ordering |
| `character_abilities` | Five original scores, names and ordering per character     |
| `character_tags`      | Original tag text and slots 1–3                            |
| `users`               | UUID, unique normalized email and Argon2id password hash   |
| `squads`              | UUID, owner, name and timestamps                           |
| `squad_members`       | Character references and ordered positions 1–6             |
| `catalog_state`       | Source checksum and catalogue revision                     |

Foreign keys reject missing references. Unique membership and position constraints independently prevent duplicates and more than six members. Normalized child tables preserve abilities/tag slots and support filtering. Indexes cover literal name search (`pg_trgm`), universe/tags, stable ordering and owned squad lists.

The canonical `frontend/src/data/characters.json` is unchanged: 208 characters, 1,040 abilities and 523 tags. Missing quote/thumbnail become `null`; missing tags become `[]`. Seeding validates before writes, runs transactionally under an advisory lock and changes revision only when source bytes change. Removing existing character IDs requires an explicit migration.

Manual commands: `npm run migration:show`, `npm run migration:run`, `npm run seed`. Rollback (`npm run migration:revert`) can remove data; use only an intended isolated database.

## API and frontend behavior

Endpoints use `/api/v1`; full schemas are in Swagger.

| Endpoint                                                                                 | Purpose                                                   |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me`                                | Register, obtain a JWT, retrieve the current user         |
| `GET /characters`, `GET /characters/filters`, `GET /characters/:id`                      | Paginated catalogue, available filters, character details |
| `GET /squads`, `POST /squads`                                                            | List/create owned squads                                  |
| `GET /squads/:id`, `PATCH /squads/:id`, `DELETE /squads/:id`                             | Read, rename/replace members atomically, delete           |
| `POST /squads/:id/characters/:characterId`, `DELETE /squads/:id/characters/:characterId` | Add/remove a member                                       |
| `GET /health`                                                                            | Actual PostgreSQL and Redis connectivity                  |

Name search is a case-insensitive literal substring. Repeated universes match any; repeated tags match all; these combine with search using AND. Pagination defaults to `page=1&limit=24` (limit 1–100), with stable source order or optional name sorts. Offset pagination suits 208 records. The UI keeps debounced search, metadata tag filters and paging; optional catalogue selectors were removed on request.

JWT tokens use `sessionStorage` for tab reloads and authenticate protected requests. Logout/expiry clears private state. This storage is accessible to page JavaScript, a tradeoff; refresh tokens are not implemented. Signed-out checkboxes are disabled with a sign-in action. Unselected checkboxes disable at six members; selected members remain removable. Mutations are pessimistic, average skeletons respect reduced motion, and errors preserve saved state. Empty averages are null.

Squads are owner-scoped; missing/nonowned squads return 404. Invalid inputs/unknown fields are rejected. Errors use `{ statusCode, error, message, details? }`; state conflicts use 409. These choices follow the PDF's suggested contract. Health uses a dependency-status payload with 200 when healthy or 503 otherwise. Passwords/hashes are excluded from public responses.

## Redis caching

Lists and filter metadata have configurable TTL. Keys contain response version, catalogue revision and every effective parameter: normalized search/filter sets, sort, page and limit. Identical effective requests reuse entries.

Revision and data come from the same PostgreSQL snapshot. Changed seeds atomically advance revision, making old entries unreachable; unchanged seeds preserve it. Old keys expire by TTL. Redis failures fall back promptly to PostgreSQL with bounded waits. Direct SQL catalogue edits bypass revision tracking and are unsupported.

## Tests and checks

After `npm ci`, start dependencies with `docker compose up -d --wait postgres redis`. Integration tests use temporary databases/Redis namespaces, preserving development data. PostgreSQL must permit database creation and `pg_trgm`; the Compose role does. Overrides: `TEST_DATABASE_ADMIN_URL`, `TEST_REDIS_URL`.

```sh
npm run test:unit           # Backend business rules
npm run test:database       # Migrations, exact seeding and constraints
npm run test:e2e            # Auth HTTP, JWTs and registration races
npm run test:catalogue      # Filtering, caching and dependency outages
npm run test:squads         # Ownership, statistics and real concurrency
npm run test:frontend       # Redux/API integration and UI states
npm run test:frontend:smoke # Real Chrome/backend flows and layout
npm run test:docker         # Isolated clean startup and persistence
npm run build
npm run typecheck
npm run lint
npm run format:check
docker compose config --quiet
git diff --check
```

Browser tests require Google Chrome. Docker verification also needs Git and checks the committed/staged implementation in isolated projects/volumes. Concurrency tests use independent PostgreSQL connections and row-lock barriers. Formatting excludes the original JSON and frontend README.

## Bonuses, tradeoffs and improvements

No PDF bonuses are implemented: WebSockets, MongoDB activity logs, rate limiting, refresh tokens, observability, CI and deployment remain optional.

CRA was retained to avoid an unrelated tooling migration. Its legacy audit findings need a separately tested maintenance update; development-tool findings do not describe the pruned backend container's runtime dependencies. Future work includes broader browser/accessibility checks and profiling larger datasets.

Supplied screenshots guided empty/selected layouts. Original Figma links remain inaccessible, so unseen prototype behavior and full fidelity are unverified. Submit the repository URL by email, with reviewer access if private, as stated in the original challenge.
