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

* `DATABASE_URL`: PostgreSQL connection string.
* `NODE_ENV`: Runtime environment. Defaults to `development`.

Example:

```bash
DATABASE_URL=postgres://user:password@localhost:5432/personal_elite_trade_db
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
* [ ] Dashboard
  * [ ] Basic authentication
  * [ ] Database stats page
  * [ ] Server stats page
  * [ ] Route planning
  * [ ] Store preferences in browser
* [ ] Database manager
  * [ ] Automated setup
  * [ ] Automatic maintenance
  * [ ] Live-patch system
  
### Internal structures

#### SQL Table layout

The database schema is not implemented yet. The initial shape will likely need tables for systems, stations, commodities, market prices, and price snapshots/import metadata.

```sql
-- Draft sketch only.
-- Final schema should be added once import/update behavior is defined.

```

## Credits

Elite: Dangerous is created by Frontier Developments. This project is an unofficial personal tool.
