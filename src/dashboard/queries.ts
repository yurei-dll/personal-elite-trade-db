export type DashboardStationTableAlias = "stations" | "destination_stations";

export const dashboardStatsQuery = `
  SELECT
    (SELECT count(*) FROM systems) AS systems,
    (SELECT count(*) FROM stations) AS stations,
    (SELECT count(*) FROM commodities) AS commodities,
    pg_database_size(current_database()) AS database_size_bytes,
    count(*) AS market_rows,
    max(collected_at) AS latest_collected_at,
    count(*) FILTER (WHERE collected_at < now() - interval '7 days') AS stale_market_rows
  FROM station_commodities
`;

export const routePlannerSystemsQuery = `
  SELECT
    systems.id::text,
    systems.name,
    systems.x,
    systems.y,
    systems.z,
    count(stations.id) FILTER (WHERE stations.has_market = true) AS market_count,
    count(stations.id) FILTER (
      WHERE stations.has_market = true
        AND regexp_replace(lower(coalesce(stations.type, '')), '[^a-z0-9]', '', 'g') = 'fleetcarrier'
    ) AS carrier_count,
    count(stations.id) FILTER (
      WHERE stations.has_market = true
        AND ${buildPlanetaryPortExpression("stations")}
    ) AS planetary_market_count,
    sqrt(
      power(systems.x - $1::double precision, 2) +
      power(systems.y - $2::double precision, 2) +
      power(systems.z - $3::double precision, 2)
    ) AS distance
  FROM systems
  LEFT JOIN stations
    ON stations.system_id = systems.id
  GROUP BY systems.id, systems.name, systems.x, systems.y, systems.z
  ORDER BY distance ASC
  LIMIT $4
`;

export const routePlannerSystemsChunkQuery = `
  SELECT
    systems.id::text,
    systems.name,
    systems.x,
    systems.y,
    systems.z,
    count(stations.id) FILTER (WHERE stations.has_market = true) AS market_count,
    count(stations.id) FILTER (
      WHERE stations.has_market = true
        AND regexp_replace(lower(coalesce(stations.type, '')), '[^a-z0-9]', '', 'g') = 'fleetcarrier'
    ) AS carrier_count,
    count(stations.id) FILTER (
      WHERE stations.has_market = true
        AND ${buildPlanetaryPortExpression("stations")}
    ) AS planetary_market_count,
    sqrt(
      power(systems.x - $1::double precision, 2) +
      power(systems.y - $2::double precision, 2) +
      power(systems.z - $3::double precision, 2)
    ) AS distance
  FROM systems
  LEFT JOIN stations
    ON stations.system_id = systems.id
  WHERE systems.x >= $1::double precision - ($5::double precision / 2)
    AND systems.x < $1::double precision + ($5::double precision / 2)
    AND systems.z >= $3::double precision - ($5::double precision / 2)
    AND systems.z < $3::double precision + ($5::double precision / 2)
  GROUP BY systems.id, systems.name, systems.x, systems.y, systems.z
  ORDER BY distance ASC
  LIMIT $4
`;

export const systemSearchQuery = `
  SELECT
    id::text,
    name,
    x,
    y,
    z
  FROM systems
  WHERE name ILIKE $1
  ORDER BY
    CASE
      WHEN name ILIKE $2 THEN 0
      ELSE 1
    END,
    name ASC
  LIMIT 12
`;

export const systemByIdQuery = `
  SELECT
    systems.id::text,
    systems.name,
    systems.x,
    systems.y,
    systems.z,
    count(stations.id) FILTER (WHERE stations.has_market = true) AS market_count,
    count(stations.id) FILTER (
      WHERE stations.has_market = true
        AND regexp_replace(lower(coalesce(stations.type, '')), '[^a-z0-9]', '', 'g') = 'fleetcarrier'
    ) AS carrier_count,
    count(stations.id) FILTER (
      WHERE stations.has_market = true
        AND ${buildPlanetaryPortExpression("stations")}
    ) AS planetary_market_count
  FROM systems
  LEFT JOIN stations
    ON stations.system_id = systems.id
  WHERE systems.id = $1::bigint
  GROUP BY systems.id, systems.name, systems.x, systems.y, systems.z
`;

export const stationSearchQuery = `
  SELECT
    stations.id::text,
    stations.name,
    systems.name AS system_name
  FROM stations
  JOIN systems
    ON systems.id = stations.system_id
  WHERE stations.name ILIKE $1
  ORDER BY
    CASE
      WHEN stations.name ILIKE $2 THEN 0
      ELSE 1
    END,
    stations.name ASC,
    systems.name ASC
  LIMIT 12
`;

export const stationByIdQuery = `
  SELECT
    stations.id::text,
    stations.name,
    stations.system_id::text,
    systems.name AS system_name,
    stations.type,
    stations.distance_to_arrival,
    stations.max_landing_pad_size,
    stations.has_market,
    stations.updated_at
  FROM stations
  JOIN systems
    ON systems.id = stations.system_id
  WHERE stations.id = $1::bigint
`;

export const stationCommoditiesQuery = `
  SELECT
    commodities.id,
    commodities.name,
    commodities.category,
    station_commodities.station_buy_price,
    station_commodities.station_sell_price,
    station_commodities.demand,
    station_commodities.demand_level,
    station_commodities.stock,
    station_commodities.stock_level,
    station_commodities.collected_at
  FROM station_commodities
  JOIN commodities
    ON commodities.id = station_commodities.commodity_id
  WHERE station_commodities.station_id = $1::bigint
  ORDER BY commodities.name ASC
`;

export function routePlannerCommoditiesQuery(options: {
  readonly includeFleetCarriers: boolean;
  readonly includePlanetary: boolean;
  readonly padSize: "M" | "L";
}): string {
  return `
    SELECT DISTINCT ON (commodities.id)
      commodities.id,
      commodities.name,
      commodities.category,
      stations.id::text AS source_station_id,
      stations.name AS source_station_name,
      ${buildPlanetaryPortExpression("stations")} AS source_is_planetary,
      station_commodities.station_sell_price,
      station_commodities.stock
    FROM stations
    JOIN station_commodities
      ON station_commodities.station_id = stations.id
    JOIN commodities
      ON commodities.id = station_commodities.commodity_id
    WHERE stations.system_id = $1::bigint
      AND stations.has_market = true
      AND station_commodities.station_sell_price > 0
      AND station_commodities.stock > 0
      AND ${buildLandingPadPredicate("stations", options.padSize)}
      AND ${buildFleetCarrierPredicate("stations", options.includeFleetCarriers)}
      AND ${buildPlanetaryPortPredicate("stations", options.includePlanetary)}
    ORDER BY
      commodities.id,
      station_commodities.station_sell_price ASC NULLS LAST,
      stations.distance_to_arrival ASC NULLS LAST,
      stations.name ASC
  `;
}

export function routePlannerTradeRouteQuery(options: {
  readonly includeFleetCarriers: boolean;
  readonly includePlanetary: boolean;
  readonly padSize: "M" | "L";
  readonly requireDestinationDemand: boolean;
}): string {
  return `
    WITH origin AS (
      SELECT id, name, x, y, z
      FROM systems
      WHERE id = $1::bigint
    ),
    source_offers AS (
      SELECT DISTINCT ON (stations.id)
        stations.id,
        stations.name,
        stations.distance_to_arrival,
        ${buildPlanetaryPortExpression("stations")} AS is_planetary,
        station_commodities.station_sell_price,
        station_commodities.stock,
        station_commodities.collected_at
      FROM stations
      JOIN station_commodities
        ON station_commodities.station_id = stations.id
      WHERE stations.system_id = $1::bigint
        AND stations.has_market = true
        AND station_commodities.commodity_id = $2
        AND station_commodities.station_sell_price > 0
        AND station_commodities.stock > 0
        AND ${buildLandingPadPredicate("stations", options.padSize)}
        AND ${buildFleetCarrierPredicate("stations", options.includeFleetCarriers)}
        AND ${buildPlanetaryPortPredicate("stations", options.includePlanetary)}
      ORDER BY
        stations.id,
        station_commodities.station_sell_price ASC NULLS LAST,
        stations.distance_to_arrival ASC NULLS LAST
    )
    SELECT
      commodities.id AS commodity_id,
      commodities.name AS commodity_name,
      commodities.category AS commodity_category,
      source_offers.id::text AS source_station_id,
      source_offers.name AS source_station_name,
      source_offers.distance_to_arrival AS source_distance_to_arrival,
      source_offers.is_planetary AS source_is_planetary,
      source_offers.station_sell_price,
      source_offers.stock,
      source_offers.collected_at AS source_collected_at,
      destination_stations.id::text AS destination_station_id,
      destination_stations.name AS destination_station_name,
      destination_stations.distance_to_arrival AS destination_distance_to_arrival,
      ${buildPlanetaryPortExpression("destination_stations")} AS destination_is_planetary,
      destination_systems.id::text AS destination_system_id,
      destination_systems.name AS destination_system_name,
      destination_systems.x AS destination_x,
      destination_systems.y AS destination_y,
      destination_systems.z AS destination_z,
      destination_markets.station_buy_price,
      destination_markets.demand,
      destination_markets.collected_at AS destination_collected_at,
      destination_markets.station_buy_price - source_offers.station_sell_price AS profit,
      sqrt(
        power(destination_systems.x - origin.x, 2) +
        power(destination_systems.y - origin.y, 2) +
        power(destination_systems.z - origin.z, 2)
      ) AS distance
    FROM origin
    JOIN source_offers
      ON true
    JOIN commodities
      ON commodities.id = $2
    JOIN station_commodities AS destination_markets
      ON destination_markets.commodity_id = $2
    JOIN stations AS destination_stations
      ON destination_stations.id = destination_markets.station_id
    JOIN systems AS destination_systems
      ON destination_systems.id = destination_stations.system_id
    WHERE destination_stations.has_market = true
      AND destination_stations.system_id <> origin.id
      AND destination_markets.station_buy_price > 0
      AND ${buildDestinationDemandPredicate(options.requireDestinationDemand)}
      AND ${buildLandingPadPredicate("destination_stations", options.padSize)}
      AND ${buildFleetCarrierPredicate("destination_stations", options.includeFleetCarriers)}
      AND ${buildPlanetaryPortPredicate("destination_stations", options.includePlanetary)}
      AND sqrt(
        power(destination_systems.x - origin.x, 2) +
        power(destination_systems.y - origin.y, 2) +
        power(destination_systems.z - origin.z, 2)
      ) <= $3::double precision
    ORDER BY
      profit DESC NULLS LAST,
      distance ASC,
      destination_markets.station_buy_price DESC NULLS LAST,
      destination_stations.distance_to_arrival ASC NULLS LAST
    LIMIT 1
  `;
}

export function routePlannerBestTradeRouteQuery(options: {
  readonly includeFleetCarriers: boolean;
  readonly includePlanetary: boolean;
  readonly padSize: "M" | "L";
  readonly requireDestinationDemand: boolean;
}): string {
  return `
    WITH origin AS (
      SELECT id, name, x, y, z
      FROM systems
      WHERE id = $1::bigint
    ),
    source_offers AS (
      SELECT DISTINCT ON (stations.id, station_commodities.commodity_id)
        stations.id,
        stations.name,
        stations.distance_to_arrival,
        ${buildPlanetaryPortExpression("stations")} AS is_planetary,
        station_commodities.commodity_id,
        station_commodities.station_sell_price,
        station_commodities.stock,
        station_commodities.collected_at
      FROM stations
      JOIN station_commodities
        ON station_commodities.station_id = stations.id
      WHERE stations.system_id = $1::bigint
        AND stations.has_market = true
        AND station_commodities.station_sell_price > 0
        AND station_commodities.stock > 0
        AND ${buildLandingPadPredicate("stations", options.padSize)}
        AND ${buildFleetCarrierPredicate("stations", options.includeFleetCarriers)}
        AND ${buildPlanetaryPortPredicate("stations", options.includePlanetary)}
      ORDER BY
        stations.id,
        station_commodities.commodity_id,
        station_commodities.station_sell_price ASC NULLS LAST,
        stations.distance_to_arrival ASC NULLS LAST
    )
    SELECT
      commodities.id AS commodity_id,
      commodities.name AS commodity_name,
      commodities.category AS commodity_category,
      source_offers.id::text AS source_station_id,
      source_offers.name AS source_station_name,
      source_offers.distance_to_arrival AS source_distance_to_arrival,
      source_offers.is_planetary AS source_is_planetary,
      source_offers.station_sell_price,
      source_offers.stock,
      source_offers.collected_at AS source_collected_at,
      destination_stations.id::text AS destination_station_id,
      destination_stations.name AS destination_station_name,
      destination_stations.distance_to_arrival AS destination_distance_to_arrival,
      ${buildPlanetaryPortExpression("destination_stations")} AS destination_is_planetary,
      destination_systems.id::text AS destination_system_id,
      destination_systems.name AS destination_system_name,
      destination_systems.x AS destination_x,
      destination_systems.y AS destination_y,
      destination_systems.z AS destination_z,
      destination_markets.station_buy_price,
      destination_markets.demand,
      destination_markets.collected_at AS destination_collected_at,
      destination_markets.station_buy_price - source_offers.station_sell_price AS profit,
      sqrt(
        power(destination_systems.x - origin.x, 2) +
        power(destination_systems.y - origin.y, 2) +
        power(destination_systems.z - origin.z, 2)
      ) AS distance
    FROM origin
    JOIN source_offers
      ON true
    JOIN commodities
      ON commodities.id = source_offers.commodity_id
    JOIN station_commodities AS destination_markets
      ON destination_markets.commodity_id = source_offers.commodity_id
    JOIN stations AS destination_stations
      ON destination_stations.id = destination_markets.station_id
    JOIN systems AS destination_systems
      ON destination_systems.id = destination_stations.system_id
    WHERE destination_stations.has_market = true
      AND destination_stations.system_id <> origin.id
      AND destination_markets.station_buy_price > 0
      AND destination_markets.station_buy_price > source_offers.station_sell_price
      AND ${buildDestinationDemandPredicate(options.requireDestinationDemand)}
      AND ${buildLandingPadPredicate("destination_stations", options.padSize)}
      AND ${buildFleetCarrierPredicate("destination_stations", options.includeFleetCarriers)}
      AND ${buildPlanetaryPortPredicate("destination_stations", options.includePlanetary)}
      AND sqrt(
        power(destination_systems.x - origin.x, 2) +
        power(destination_systems.y - origin.y, 2) +
        power(destination_systems.z - origin.z, 2)
      ) <= $2::double precision
    ORDER BY
      profit DESC NULLS LAST,
      destination_markets.demand DESC NULLS LAST,
      distance ASC,
      destination_markets.station_buy_price DESC NULLS LAST,
      destination_stations.distance_to_arrival ASC NULLS LAST,
      source_offers.distance_to_arrival ASC NULLS LAST
    LIMIT 1
  `;
}

export function marketBrowserStationsQuery(options: {
  readonly includeFleetCarriers: boolean;
  readonly includePlanetary: boolean;
}): string {
  return `
    SELECT
      stations.id::text,
      stations.name,
      stations.type,
      stations.distance_to_arrival,
      stations.max_landing_pad_size,
      stations.has_market,
      stations.updated_at,
      count(DISTINCT station_commodities.commodity_id)
        FILTER (
          WHERE station_commodities.station_buy_price > 0
            AND coalesce(station_commodities.demand, 0) > 0
        ) AS bought_commodity_count,
      count(DISTINCT station_commodities.commodity_id)
        FILTER (
          WHERE station_commodities.station_sell_price > 0
            AND coalesce(station_commodities.stock, 0) > 0
        ) AS sold_commodity_count
    FROM stations
    LEFT JOIN station_commodities
      ON station_commodities.station_id = stations.id
    WHERE stations.system_id = $1::bigint
      AND stations.has_market = true
      AND ${buildFleetCarrierPredicate("stations", options.includeFleetCarriers)}
      AND ${buildPlanetaryPortPredicate("stations", options.includePlanetary)}
    GROUP BY stations.id
    ORDER BY stations.distance_to_arrival ASC NULLS LAST, stations.name ASC
  `;
}

export function marketBrowserCommoditiesQuery(options: {
  readonly includeFleetCarriers: boolean;
  readonly includePlanetary: boolean;
  readonly stationTradeRole: "station_buys" | "station_sells";
}): string {
  const priceColumn =
    options.stationTradeRole === "station_buys"
      ? "station_buy_price"
      : "station_sell_price";
  const availabilityPredicate =
    options.stationTradeRole === "station_buys"
      ? "coalesce(station_commodities.demand, 0) > 0"
      : "coalesce(station_commodities.stock, 0) > 0";

  return `
    SELECT DISTINCT
      commodities.id,
      commodities.name,
      commodities.category
    FROM stations
    JOIN station_commodities
      ON station_commodities.station_id = stations.id
    JOIN commodities
      ON commodities.id = station_commodities.commodity_id
    WHERE stations.system_id = $1::bigint
      AND stations.has_market = true
      AND station_commodities.${priceColumn} > 0
      AND ${availabilityPredicate}
      AND ${buildFleetCarrierPredicate("stations", options.includeFleetCarriers)}
      AND ${buildPlanetaryPortPredicate("stations", options.includePlanetary)}
    ORDER BY commodities.name ASC
  `;
}

export function routePlannerWaypointsQuery(): string {
  return `
    WITH origin AS (
      SELECT id, x, y, z
      FROM systems
      WHERE id = $1::bigint
    ),
    targets AS (
      SELECT
        jump_index,
        origin.x + (($2::double precision - origin.x) * jump_index / $5::double precision) AS target_x,
        origin.y + (($3::double precision - origin.y) * jump_index / $5::double precision) AS target_y,
        origin.z + (($4::double precision - origin.z) * jump_index / $5::double precision) AS target_z
      FROM origin
      CROSS JOIN generate_series(1, greatest($5::integer - 1, 0)) AS jumps(jump_index)
    )
    SELECT
      targets.jump_index,
      systems.id::text,
      systems.name,
      systems.x,
      systems.y,
      systems.z,
      sqrt(
        power(systems.x - targets.target_x, 2) +
        power(systems.y - targets.target_y, 2) +
        power(systems.z - targets.target_z, 2)
      ) AS distance
    FROM targets
    CROSS JOIN LATERAL (
      SELECT id, name, x, y, z
      FROM systems
      WHERE id <> $1::bigint
        AND id <> $6::bigint
      ORDER BY
        power(x - targets.target_x, 2) +
        power(y - targets.target_y, 2) +
        power(z - targets.target_z, 2) ASC
      LIMIT 1
    ) AS systems
    ORDER BY targets.jump_index ASC
  `;
}

export function routePlannerReturnHaulQuery(options: {
  readonly includeFleetCarriers: boolean;
  readonly includePlanetary: boolean;
  readonly padSize: "M" | "L";
  readonly requireDestinationDemand: boolean;
}): string {
  return `
    WITH source_offers AS (
      SELECT
        stations.id,
        stations.name,
        ${buildPlanetaryPortExpression("stations")} AS is_planetary,
        station_commodities.commodity_id,
        station_commodities.station_sell_price,
        station_commodities.stock,
        station_commodities.collected_at
      FROM stations
      JOIN station_commodities
        ON station_commodities.station_id = stations.id
      WHERE stations.system_id = $1::bigint
        AND stations.has_market = true
        AND station_commodities.station_sell_price > 0
        AND station_commodities.stock > 0
        AND ${buildLandingPadPredicate("stations", options.padSize)}
        AND ${buildFleetCarrierPredicate("stations", options.includeFleetCarriers)}
        AND ${buildPlanetaryPortPredicate("stations", options.includePlanetary)}
    )
    SELECT
      commodities.id AS commodity_id,
      commodities.name AS commodity_name,
      commodities.category AS commodity_category,
      source_offers.id::text AS source_station_id,
      source_offers.name AS source_station_name,
      source_offers.is_planetary AS source_is_planetary,
      source_offers.station_sell_price,
      source_offers.stock,
      source_offers.collected_at AS source_collected_at,
      destination_stations.id::text AS destination_station_id,
      destination_stations.name AS destination_station_name,
      ${buildPlanetaryPortExpression("destination_stations")} AS destination_is_planetary,
      destination_markets.station_buy_price,
      destination_markets.demand,
      destination_markets.collected_at AS destination_collected_at,
      destination_markets.station_buy_price - source_offers.station_sell_price AS profit
    FROM source_offers
    JOIN commodities
      ON commodities.id = source_offers.commodity_id
    JOIN station_commodities AS destination_markets
      ON destination_markets.commodity_id = source_offers.commodity_id
    JOIN stations AS destination_stations
      ON destination_stations.id = destination_markets.station_id
    WHERE destination_stations.system_id = $2::bigint
      AND destination_stations.has_market = true
      AND destination_markets.station_buy_price > 0
      AND ${buildDestinationDemandPredicate(options.requireDestinationDemand)}
      AND ${buildLandingPadPredicate("destination_stations", options.padSize)}
      AND ${buildFleetCarrierPredicate("destination_stations", options.includeFleetCarriers)}
      AND ${buildPlanetaryPortPredicate("destination_stations", options.includePlanetary)}
    ORDER BY
      profit DESC NULLS LAST,
      destination_markets.station_buy_price DESC NULLS LAST,
      destination_stations.distance_to_arrival ASC NULLS LAST
    LIMIT 1
  `;
}

function buildLandingPadPredicate(
  tableAlias: DashboardStationTableAlias,
  padSize: "M" | "L",
): string {
  const allowedPadSizes =
    padSize === "L"
      ? "'L', 'LARGE'"
      : "'M', 'MEDIUM', 'L', 'LARGE'";

  return `(${tableAlias}.max_landing_pad_size IS NULL OR upper(${tableAlias}.max_landing_pad_size) IN (${allowedPadSizes}))`;
}

function buildPlanetaryPortPredicate(
  tableAlias: DashboardStationTableAlias,
  includePlanetary: boolean,
): string {
  return includePlanetary
    ? "true"
    : `NOT ${buildPlanetaryPortExpression(tableAlias)}`;
}

function buildPlanetaryPortExpression(
  tableAlias: DashboardStationTableAlias,
): string {
  const normalizedType = `regexp_replace(lower(coalesce(${tableAlias}.type, '')), '[^a-z0-9]', '', 'g')`;

  return `(${tableAlias}.is_planetary IS TRUE OR ${normalizedType} IN ('planetaryport', 'planetaryoutpost', 'odysseysettlement'))`;
}

function buildFleetCarrierPredicate(
  tableAlias: DashboardStationTableAlias,
  includeFleetCarriers: boolean,
): string {
  return includeFleetCarriers
    ? "true"
    : `regexp_replace(lower(coalesce(${tableAlias}.type, '')), '[^a-z0-9]', '', 'g') <> 'fleetcarrier'`;
}

function buildDestinationDemandPredicate(requireDestinationDemand: boolean): string {
  return requireDestinationDemand
    ? "coalesce(destination_markets.demand, 0) > 0"
    : "true";
}
