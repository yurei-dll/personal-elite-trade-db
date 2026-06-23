# personal-elite-trade-db

A personal database for trading in game Elite: Dangerous.

## Requirements

* Node.js 20 or newer
* npm
* PostgreSQL, including the `psql` client

## Configuring

Copy the example environment file and fill in your local database connection:

```bash
cp .env.example .env
```

The app currently reads these environment variables:

* `ADMIN_PASSWORD_HASH`: Password hash for destructive dashboard actions.
* `DATABASE_URL`: PostgreSQL connection string.
* `DASHBOARD_PASSWORD_HASH`: Password hash for read-only dashboard access.
* `NODE_ENV`: Runtime environment. Defaults to `development`.

Example:

```bash
DATABASE_URL=postgres://user:password@localhost:5432/personal_elite_trade_db
DASHBOARD_PASSWORD_HASH=
ADMIN_PASSWORD_HASH=
NODE_ENV=development
```

## Running

Install dependencies:

```bash
npm install
```

Run the TypeScript source directly during development:

```bash
npm run dev
```

Build and run the compiled JavaScript:

```bash
npm run build
npm start
```

## Developing

Useful scripts:

* `npm run dev`: Run `src/index.ts` with `tsx`.
* `npm run build`: Compile TypeScript into `dist/`.
* `npm start`: Run the compiled app from `dist/index.js`.
* `npm run typecheck`: Type-check without writing build output.
* `npm test`: Alias for `npm run typecheck`.

Source files live in `src/`. Build output is written to `dist/` and should not be committed.

### Roadmap

* [x] Basic CLI entrypoint
* [ ] Database manager
  * [ ] Automated setup
  * [ ] Automatic maintenance
    * [ ] Track stale data
  * [ ] Live-patch EDDN ingestion
    * [ ] Connect to EDDN stream
    * [ ] Parse commodity market messages
    * [ ] Store station/system/commodity data
* [ ] Dashboard
  * [ ] Basic authentication
    * [ ] Password storage with `bcrypt`
    * [ ] Credential manager back-end
      * [ ] Read-only access by default
      * [ ] Privilege escalation using separate password for destructive actions.
    * [ ] Basic rate-limiting for incorrect login attempts
  * [ ] Database stats page
  * [ ] Server stats page
  * [ ] Route planning
  * [ ] Store preferences in browser

### Internal structures

#### SQL Table layout

```sql
-- Draft sketch only.
-- systems FIRST
CREATE TABLE systems (
    id BIGINT PRIMARY KEY,
    name TEXT,
    x NUMERIC,
    y NUMERIC,
    z NUMERIC
);

CREATE TABLE stations (
    id BIGINT PRIMARY KEY,
    name TEXT,
    system_id BIGINT REFERENCES systems(id),
    distance_to_arrival NUMERIC,
    type TEXT
);

CREATE TABLE commodities (
    id TEXT PRIMARY KEY,
    name TEXT
);

CREATE TABLE station_commodities (
    station_id BIGINT REFERENCES stations(id),
    commodity_id TEXT REFERENCES commodities(id),
    sell_price NUMERIC,
    buy_price NUMERIC,
    demand BIGINT,
    stock BIGINT
);
```

## Credits

Elite: Dangerous is created by Frontier Developments. This project is an unofficial personal tool.
