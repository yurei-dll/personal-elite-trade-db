# personal-elite-trade-db

A personal database for trading in game Elite: Dangerous.

## Requirements

* Node.js 20 or newer
* npm
* PostgreSQL, including the `psql` client

## Configuring

The app creates and maintains two local configuration files when it starts:

* `config.json`: Non-secret runtime settings.
* `.env`: Credentials and other secrets.

You can also seed them from the examples:

```bash
cp config.example.json config.json
cp .env.example .env
```

`config.json` settings:

* `database.host`: PostgreSQL host. Defaults to the local PostgreSQL socket.
* `database.name`: PostgreSQL database name. Defaults to `personal_elite_trade_db`.
* `database.port`: PostgreSQL port. Defaults to `5432`.
* `nodeEnv`: Runtime environment. Defaults to `development`.

`.env` settings:

* `DATABASE_URL`: PostgreSQL connection string.
  Overrides the generated connection URL when set.
* `DATABASE_USERNAME`: PostgreSQL username. Defaults to the current system username.
* `DATABASE_PASSWORD`: Optional PostgreSQL password for the generated connection URL.
* `DASHBOARD_PASSWORD_HASH`: Password hash for read-only dashboard access.
* `ADMIN_PASSWORD_HASH`: Password hash for destructive dashboard actions.

The loader still honors these environment variable overrides for deployment:
`DATABASE_HOST`, `DATABASE_NAME`, `DATABASE_PORT`, and `NODE_ENV`.

`config.json` example:

```json
{
  "database": {
    "host": "/var/run/postgresql",
    "name": "personal_elite_trade_db",
    "port": 5432
  },
  "nodeEnv": "development"
}
```

`.env` example:

```bash
DATABASE_URL=
DATABASE_USERNAME=
DATABASE_PASSWORD=
DASHBOARD_PASSWORD_HASH=
ADMIN_PASSWORD_HASH=
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
CREATE TABLE systems (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    z DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE stations (
    id BIGINT PRIMARY KEY,
    system_id BIGINT NOT NULL REFERENCES systems(id),
    name TEXT NOT NULL,
    type TEXT,
    distance_to_arrival DOUBLE PRECISION,
    max_landing_pad_size TEXT,
    has_market BOOLEAN NOT NULL DEFAULT false,
    is_planetary BOOLEAN,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (system_id, name)
);

CREATE TABLE commodities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE station_commodities (
    station_id BIGINT NOT NULL REFERENCES stations(id),
    commodity_id TEXT NOT NULL REFERENCES commodities(id),
    station_sell_price BIGINT,
    station_buy_price BIGINT,
    demand BIGINT,
    demand_level TEXT,
    stock BIGINT,
    stock_level TEXT,
    collected_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source TEXT NOT NULL,
    PRIMARY KEY (station_id, commodity_id)
);

CREATE INDEX station_commodities_commodity_id_idx
    ON station_commodities (commodity_id);

CREATE INDEX station_commodities_collected_at_idx
    ON station_commodities (collected_at);
```

## Credits

Elite: Dangerous is created by Frontier Developments. This project is an unofficial personal tool.
