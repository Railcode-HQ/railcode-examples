/** Client-side guard rails for model-authored SQL.
 *
 *  Railcode data connections are already read-only server-side, so this is
 *  defence in depth, not the only line of defence. It exists because the model
 *  writes the query: a confidently-wrong `DELETE` should fail loudly here with
 *  an explanation the model can read and correct, rather than travelling to the
 *  database and coming back as an opaque permission error.
 *
 *  Everything is checked against a copy with string literals and comments
 *  blanked out, so a table called `orders_update` or the text `'drop'` inside a
 *  WHERE clause doesn't trip the keyword check. */

const MAX_ROWS = 500;

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze|merge|call|do|refresh|reindex|cluster|comment|lock|set|reset|begin|commit|rollback|savepoint|prepare|execute|deallocate|listen|notify|discard|security)\b/i;

/** Replace the *contents* of literals/comments with spaces, preserving length
 *  and structure so offsets and statement separators stay meaningful. */
function blankOut(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }

    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }

    // Dollar-quoted strings: $$ ... $$ or $tag$ ... $tag$
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }

    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          // Doubled quote is an escaped quote, not a terminator.
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      out += " ".repeat(j - i);
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

export class SqlRejected extends Error {}

/** Validate and normalize a model-authored query.
 *  Throws `SqlRejected` with a message written to be fed back to the model. */
export function prepareReadOnlySql(input: string, maxRows = MAX_ROWS): string {
  const sql = input.trim().replace(/;\s*$/, "").trim();
  if (!sql) throw new SqlRejected("The query was empty.");

  const bare = blankOut(sql);

  if (bare.includes(";")) {
    throw new SqlRejected(
      "Only a single statement is allowed — remove the ';' and send one query.",
    );
  }

  if (!/^\s*(select|with)\b/i.test(bare)) {
    throw new SqlRejected(
      "Only SELECT (or WITH … SELECT) queries are allowed. This connection is read-only.",
    );
  }

  const banned = FORBIDDEN.exec(bare);
  if (banned) {
    throw new SqlRejected(
      `The keyword '${banned[1].toUpperCase()}' is not allowed — this connection is read-only, use a SELECT instead.`,
    );
  }

  // Cap unbounded result sets. A LIMIT inside a subquery or CTE doesn't bound
  // the outer result, so only a trailing one counts.
  if (/\blimit\s+\d+\s*(offset\s+\d+\s*)?$/i.test(bare)) return sql;
  return `${sql}\nLIMIT ${maxRows}`;
}
