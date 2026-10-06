// Turns a support search box query into SQL. Pure: no database access, so the parsing is unit-tested on its own.

export interface SearchTerms {
  q: string;
  // websearch syntax (quotes, OR, -word) was used: only the full-text match applies, so fuzzy or substring matches
  // can't let an excluded ticket back in.
  operators: boolean;
  tsquery: { sql: string; bindings: string[] };
  code: string | null;
  phone: string | null;
  like: string;
}

const CODE = /^(?:st[\s-]?)?([a-hj-np-z2-9]{6})$/i;
const PHONE = /^\+?[\d\s-]{7,}$/;

export function searchTerms(raw: string): SearchTerms {
  const q = raw.trim();
  const operators = /["]|(^|\s)-\S|\sOR\s/.test(q);
  // Letters and digits only, so nothing in a token can be read as tsquery syntax. Each token matches as a prefix:
  // "refu" finds "refund". Matched both stemmed ("charged" finds "charge") and as typed: the stemmer rewrites some
  // prefixes ("carry" to "carri") that then miss the longer word.
  const tokens = q.match(/[\p{L}\p{N}]+/gu) ?? [];
  const prefix = tokens.map((t) => `${t}:*`).join(" & ");
  const tsquery =
    operators || tokens.length === 0
      ? { sql: `websearch_to_tsquery('english', ?)`, bindings: [q] }
      : { sql: `(to_tsquery('english', ?) || to_tsquery('simple', ?))`, bindings: [prefix, prefix] };

  const code = CODE.exec(q)?.[1];
  const digits = PHONE.test(q) ? q.replace(/\D/g, "").replace(/^(233|0)/, "") : null;
  return {
    q,
    operators,
    tsquery,
    code: code ? `ST-${code.toUpperCase()}` : null,
    phone: digits && digits.length >= 7 ? digits : null,
    like: `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
  };
}

export interface Clause {
  sql: string;
  bindings: string[];
  weight: number;
}

const FUZZY_MIN_LENGTH = 4;
const FUZZY_THRESHOLD = 0.5;

// Each way a ticket can match, with how much it counts towards relevance. Staff also match on the raiser and the
// assignee, and on notes and deleted messages; a raiser only on their tickets' own public, undeleted messages.
export function searchClauses(terms: SearchTerms, staff: boolean): Clause[] {
  const { tsquery } = terms;
  const visible = staff ? "" : `AND m.internal = false AND m."deletedAt" IS NULL`;
  const clauses: Clause[] = [
    {
      sql: `to_tsvector('english', t.subject) @@ ${tsquery.sql}`,
      bindings: tsquery.bindings,
      weight: 40,
    },
    {
      // Uncorrelated, so Postgres probes the GIN index on searchVector once rather than per ticket.
      sql: `t.id IN (SELECT m."ticketId" FROM "supportTicketMessages" m WHERE m."searchVector" @@ ${tsquery.sql} ${visible})`,
      bindings: tsquery.bindings,
      weight: 5,
    },
  ];
  if (terms.code) clauses.push({ sql: `t.code = ?`, bindings: [terms.code], weight: 100 });
  if (terms.operators) return clauses;

  clauses.push(
    { sql: `t.code ILIKE ?`, bindings: [terms.like], weight: 10 },
    { sql: `t.subject ILIKE ?`, bindings: [terms.like], weight: 10 },
  );
  const fuzzy = terms.q.length >= FUZZY_MIN_LENGTH;
  if (fuzzy) {
    clauses.push({ sql: `word_similarity(?, t.subject) >= ${FUZZY_THRESHOLD}`, bindings: [terms.q], weight: 10 });
  }
  if (!staff) return clauses;

  const people = [`u."fullName" ILIKE ?`, `u.email ILIKE ?`];
  const bindings = [terms.like, terms.like];
  if (fuzzy) {
    people.push(`word_similarity(?, u."fullName") >= ${FUZZY_THRESHOLD}`);
    bindings.push(terms.q);
  }
  if (terms.phone) {
    people.push(`regexp_replace(u."phoneNumber", '^0', '') = ?`);
    bindings.push(terms.phone);
  }
  clauses.push(
    {
      sql: `t."userId" IN (SELECT u.id FROM users u WHERE ${people.join(" OR ")})`,
      bindings,
      weight: 10,
    },
    {
      sql: `t."assignedAdminId" IN (SELECT u.id FROM users u WHERE u."fullName" ILIKE ?)`,
      bindings: [terms.like],
      weight: 10,
    },
  );
  return clauses;
}

export function matchSql(clauses: Clause[]) {
  return { sql: `(${clauses.map((c) => c.sql).join(" OR ")})`, bindings: clauses.flatMap((c) => c.bindings) };
}

export function scoreSql(clauses: Clause[]) {
  return {
    sql: `(${clauses.map((c) => `CASE WHEN ${c.sql} THEN ${c.weight} ELSE 0 END`).join(" + ")})`,
    bindings: clauses.flatMap((c) => c.bindings),
  };
}
