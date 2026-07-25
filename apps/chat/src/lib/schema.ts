/** Postgres schema introspection.
 *
 *  Text-to-SQL only works if the model knows the actual tables — without this it
 *  invents plausible ones (`tickets.sla_risk`) and the query fails. We read
 *  `information_schema` once per session and inline a compact digest into the
 *  system prompt, which is far cheaper and more reliable than giving the model a
 *  "describe the schema" tool it has to remember to call. */

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pscale_extensions"];

/** Shorten Postgres type names so the digest stays small. */
const TYPE_ALIASES: Record<string, string> = {
  "character varying": "varchar",
  "character": "char",
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  "double precision": "float8",
  "boolean": "bool",
  "integer": "int",
  "bigint": "int8",
  "numeric": "numeric",
};

export type SchemaInfo = {
  connection: string;
  digest: string;
  tableCount: number;
};

let cache: Promise<SchemaInfo> | null = null;

/** Prefer a connection literally named for this template, else the first
 *  Postgres connection the org exposes — so the app still works in an org that
 *  named its database something else. */
async function resolveConnection(): Promise<string> {
  const connectors = await dataConnectors();
  const postgresOnly = connectors.filter((c) => c.engine === "postgres");
  if (postgresOnly.length === 0) {
    throw new Error(
      "No Postgres data connection is configured for this organization.",
    );
  }
  const preferred = postgresOnly.find((c) => c.name === "railcode-demo");
  return (preferred ?? postgresOnly[0]).name;
}

async function introspect(): Promise<SchemaInfo> {
  const connection = await resolveConnection();
  const placeholders = SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await data(connection).runSQL(
    `select table_schema, table_name, column_name, data_type
       from information_schema.columns
      where table_schema not in (${placeholders})
      order by table_schema, table_name, ordinal_position`,
    SYSTEM_SCHEMAS,
  );

  const tables = new Map<string, string[]>();
  for (const row of rows) {
    const schema = String(row.table_schema);
    const table = String(row.table_name);
    const column = String(row.column_name);
    const rawType = String(row.data_type);
    const type = TYPE_ALIASES[rawType] ?? rawType;
    const qualified = `${schema}.${table}`;
    const cols = tables.get(qualified);
    if (cols) cols.push(`${column} ${type}`);
    else tables.set(qualified, [`${column} ${type}`]);
  }

  const digest = [...tables.entries()]
    .map(([table, cols]) => `${table}(${cols.join(", ")})`)
    .join("\n");

  return { connection, digest, tableCount: tables.size };
}

export function loadSchema(): Promise<SchemaInfo> {
  if (!cache) {
    cache = introspect().catch((err) => {
      // Don't cache a failure — a transient outage shouldn't poison the session.
      cache = null;
      throw err;
    });
  }
  return cache;
}
