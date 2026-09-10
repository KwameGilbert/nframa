// Generates docs/db-schema.sql from docs/db-schema.json (single source of truth).
// Run: node scripts/generate-db-schema-sql.js   (writes docs/db-schema.sql)
const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, '..', 'docs', 'db-schema.json');
const sqlOutPath = path.join(__dirname, '..', 'docs', 'db-schema.sql');
const schema = require(jsonPath);

const { models, enums, migrationOrder } = schema;
const out = [];
const p = (s = '') => out.push(s);

// ---- known forward-reference exceptions: FK added via ALTER TABLE after the target exists ----
const DEFERRED_FKS = [
  { table: 'bookings', column: 'transitPassId', refTable: 'transitPasses', refField: 'id' },
];
const deferredKey = (t, c) => `${t}.${c}`;
const deferredSet = new Set(DEFERRED_FKS.map((d) => deferredKey(d.table, d.column)));

// ---- explicit ON DELETE RESTRICT relationships (documented in db-schema.md) ----
const RESTRICT_FKS = new Set([
  'adminUsers.roleId', // roles deletion blocked while admins reference it
  'routes.cityId', // operatingCities deletion blocked while routes reference it
]);

// ---- hand-written table-level CHECK constraints (free-text business rules in the JSON) ----
const TABLE_CHECKS = {
  schedules: [
    `CHECK ((("recurrenceDays" IS NOT NULL) AND ("oneOffDate" IS NULL)) OR (("recurrenceDays" IS NULL) AND ("oneOffDate" IS NOT NULL)))`,
  ],
  ticketReplies: [
    `CHECK ((("authorType" = 'admin') AND ("authorAdminId" IS NOT NULL) AND ("authorUserId" IS NULL)) OR (("authorType" = 'user') AND ("authorUserId" IS NOT NULL) AND ("authorAdminId" IS NULL)))`,
  ],
  platformSettings: [`CHECK ("id" = 1)`],
};

// ---- hand-written column-level CHECK constraints called out in field notes but not modeled as enums ----
const COLUMN_CHECKS = {
  'ratings.score': `CHECK ("score" BETWEEN 1 AND 5)`,
  'platformSettings.minDriverAge': `CHECK ("minDriverAge" >= 18)`,
};

function sqlIdent(name) {
  return `"${name}"`;
}

function sqlStringLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function columnType(field) {
  if (field.dbType) return field.dbType;
  switch (field.type) {
    case 'String':
      return 'text';
    case 'Int':
      return 'integer';
    case 'BigInt':
      return 'bigint';
    case 'Boolean':
      return 'boolean';
    case 'DateTime':
      return 'timestamptz';
    case 'Decimal':
      return 'numeric';
    case 'Json':
      return 'jsonb';
    default:
      return 'text';
  }
}

// Extracts { prefixLiteral, seqName } from a "'RID-' || nextval('riderProfilesCodeSeq')" style default.
function parseCodeSequenceDefault(raw) {
  const m = raw.match(/'([^']*)-'\s*\|\|\s*nextval\('(\w+)'\)/);
  if (!m) return null;
  return { prefix: m[1], seqName: m[2] };
}

function unwrapDbGenerated(defaultVal) {
  const m = defaultVal.match(/^dbgenerated\("(.*)"\)$/s);
  return m ? m[1] : null;
}

// Collects every code-sequence a table needs, so they can all be created up front.
function collectSequences() {
  const seqs = [];
  for (const [tableName, model] of Object.entries(models)) {
    for (const field of model.fields) {
      if (typeof field.default !== 'string') continue;
      const inner = unwrapDbGenerated(field.default);
      if (!inner) continue;
      const parsed = parseCodeSequenceDefault(inner);
      if (parsed) seqs.push({ tableName, fieldName: field.name, ...parsed });
    }
  }
  return seqs;
}

function fieldDefaultSql(field) {
  const { default: def, type } = field;
  if (def === undefined || def === null) return null;

  if (typeof def === 'boolean') return def ? 'TRUE' : 'FALSE';
  if (typeof def === 'number') return String(def);

  if (typeof def === 'string') {
    if (def === 'now()') return 'now()';

    const inner = unwrapDbGenerated(def);
    if (inner !== null) {
      const parsed = parseCodeSequenceDefault(inner);
      if (parsed) {
        return `(${sqlStringLiteral(parsed.prefix + '-')} || nextval('${sqlIdentInsideString(parsed.seqName)}'))`;
      }
      // e.g. gen_random_uuid()
      return inner;
    }

    // Plain string default -> this is an enum/text literal (e.g. "active", "pending")
    return sqlStringLiteral(def);
  }

  return null;
}

// Produces the nextval() text argument with the identifier double-quoted to preserve case,
// e.g. nextval('"riderProfilesCodeSeq"')
function sqlIdentInsideString(name) {
  return `"${name}"`;
}

function columnDefinitionSql(tableName, field) {
  const parts = [sqlIdent(field.name)];
  const type = columnType(field);
  parts.push(type);

  const isEnum = field.type && enums[field.type];

  if (field.id) {
    parts.push('PRIMARY KEY');
  }
  if (field.required && !field.id) {
    parts.push('NOT NULL');
  }
  if (field.unique && !field.id) {
    parts.push('UNIQUE');
  }

  const defaultSql = fieldDefaultSql(field);
  if (defaultSql !== null) {
    parts.push(`DEFAULT ${defaultSql}`);
  }

  if (isEnum) {
    const values = enums[field.type].map(sqlStringLiteral).join(', ');
    parts.push(`CHECK (${sqlIdent(field.name)} IN (${values}))`);
  }

  const columnCheck = COLUMN_CHECKS[`${tableName}.${field.name}`];
  if (columnCheck) {
    parts.push(columnCheck);
  }

  if (field.relation) {
    const key = deferredKey(tableName, field.name);
    if (!deferredSet.has(key)) {
      let ref = `REFERENCES ${sqlIdent(field.relation.model)}(${sqlIdent(field.relation.field)})`;
      if (RESTRICT_FKS.has(`${tableName}.${field.name}`)) {
        ref += ' ON DELETE RESTRICT';
      }
      parts.push(ref);
    }
  }

  return parts.join(' ');
}

function fieldComment(field) {
  const bits = [];
  if (field.polymorphic) {
    bits.push(`polymorphic — may reference: ${(field.possibleReferences || []).join(', ')} (no FK constraint)`);
  }
  if (field.note) bits.push(field.note);
  return bits.length ? `  -- ${bits.join(' | ')}` : '';
}

function generateTable(tableName) {
  const model = models[tableName];
  const lines = [];
  lines.push(`-- ${tableName}${model.description ? ' — ' + model.description : ''}`);
  lines.push(`CREATE TABLE ${sqlIdent(tableName)} (`);

  // Each entry: { content, comment }. The comma MUST precede a trailing line comment
  // (a `-- ...` comment runs to end-of-line, so a comma placed after it would be
  // silently swallowed and break the statement) — so commas are added in the final
  // join step, never inside `content` or `comment` themselves.
  const entries = model.fields.map((field) => ({
    content: '  ' + columnDefinitionSql(tableName, field),
    comment: fieldComment(field),
  }));

  for (const uq of model.uniqueConstraints || []) {
    entries.push({ content: `  UNIQUE (${uq.map(sqlIdent).join(', ')})`, comment: '' });
  }
  for (const chk of TABLE_CHECKS[tableName] || []) {
    entries.push({ content: `  ${chk}`, comment: '' });
  }

  const body = entries
    .map((entry, i) => {
      const isLast = i === entries.length - 1;
      const comma = isLast ? '' : ',';
      return entry.comment ? `${entry.content}${comma} ${entry.comment}` : `${entry.content}${comma}`;
    })
    .join('\n');

  lines.push(body);
  lines.push(');');

  return lines.join('\n');
}

function generateIndexes(tableName) {
  const model = models[tableName];
  const lines = [];

  for (const idx of model.indexes || []) {
    const idxName = `idx_${tableName}_${idx.fields.join('_')}`;
    lines.push(
      `CREATE INDEX ${sqlIdent(idxName)} ON ${sqlIdent(tableName)} (${idx.fields.map(sqlIdent).join(', ')});`,
    );
  }

  for (const puq of model.partialUniqueIndexes || []) {
    const idxName = `uq_${tableName}_${puq.fields.join('_')}_partial`;
    lines.push(
      `CREATE UNIQUE INDEX ${sqlIdent(idxName)} ON ${sqlIdent(tableName)} (${puq.fields
        .map(sqlIdent)
        .join(', ')}) WHERE ${puq.where};${puq.note ? ` -- ${puq.note}` : ''}`,
    );
  }

  return lines.join('\n');
}

// ============================== build the file ==============================

p('-- ============================================================================');
p('-- Nframa — PostgreSQL schema (generated from docs/db-schema.json)');
p('--');
p('-- This file is a reference DDL dump, generated mechanically from the single');
p('-- source of truth at docs/db-schema.json. Per CLAUDE.md, this project runs');
p('-- migrations as Knex TypeScript files under database/migrations/, NOT raw');
p('-- .sql files — use this as the authoritative reference when authoring those');
p('-- migrations (via `pnpm db:migrate:make <name>`), or to stand up a scratch');
p('-- database for prototyping / ERD generation.');
p('--');
p('-- Naming: every table/column is camelCase and therefore double-quoted');
p('-- throughout — Postgres folds unquoted identifiers to lowercase.');
p('-- Enums are modeled as `text` + CHECK constraints, not native Postgres enums,');
p('-- matching this project\'s convention (see docs/db-schema.md §1).');
p('-- ============================================================================');
p();
p('BEGIN;');
p();
p('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
p();

// ---- sequences (all up front, so table-creation order never matters for defaults) ----
const sequences = collectSequences();
p('-- ----------------------------------------------------------------------------');
p('-- Sequences backing human-facing display codes (e.g. TRP-7210). These are');
p('-- NEVER primary keys — see the `code` column on each table below.');
p('-- ----------------------------------------------------------------------------');
for (const seq of sequences) {
  p(`CREATE SEQUENCE IF NOT EXISTS ${sqlIdent(seq.seqName)};`);
}
p();

// ---- tables, grouped by migrationOrder (also the correct FK dependency order) ----
for (const group of migrationOrder) {
  p('-- ============================================================================');
  p(`-- Group ${group.group}: ${group.title}`);
  p('-- ============================================================================');
  p();
  for (const tableName of group.tables) {
    p(generateTable(tableName));
    p();

    // attach sequence ownership right after its table exists
    const ownedSeqs = sequences.filter((s) => s.tableName === tableName);
    for (const seq of ownedSeqs) {
      p(`ALTER SEQUENCE ${sqlIdent(seq.seqName)} OWNED BY ${sqlIdent(tableName)}.${sqlIdent(seq.fieldName)};`);
    }
    if (ownedSeqs.length) p();

    const idxSql = generateIndexes(tableName);
    if (idxSql) {
      p(idxSql);
      p();
    }

    // resolve any deferred FK whose target table is this one
    const resolved = DEFERRED_FKS.filter((d) => d.refTable === tableName);
    for (const d of resolved) {
      p(
        `ALTER TABLE ${sqlIdent(d.table)} ADD CONSTRAINT ${sqlIdent(
          `${d.table}_${d.column}_fkey`,
        )} FOREIGN KEY (${sqlIdent(d.column)}) REFERENCES ${sqlIdent(d.refTable)}(${sqlIdent(d.refField)}); -- deferred: ${d.refTable} is created in a later migration group than ${d.table}`,
      );
      p();
    }
  }
}

p('COMMIT;');

fs.writeFileSync(sqlOutPath, out.join('\n') + '\n');
console.error(`Wrote ${sqlOutPath}`);
