---
name: "database-sql"
description: "Best practices for Database & SQL engineering (PostgreSQL, MySQL, SQLite, schema design, migrations, and dbExplorer integration)."
tags: "database, sql, postgres, postgresql, mysql, sqlite, schema, migrations, dbexplorer"
---

# Database & SQL Engineering Skill

Follow these patterns when designing schemas, writing queries, integrating databases into backend services, and inspecting live databases in `plumar-cli`.

## 1. Live Database Inspection with `dbExplorer`
You have direct access to the built-in `dbExplorer` tool for PostgreSQL (`postgres://...`) and MySQL (`mysql://...`) databases:
- **Inspect Schema & Tables**:
  ```json
  {
    "name": "dbExplorer",
    "arguments": {
      "connectionUri": "postgres://user:pass@localhost:5432/dbname",
      "action": "schema"
    }
  }
  ```
- **Run Diagnostic or Verification Queries**:
  ```json
  {
    "name": "dbExplorer",
    "arguments": {
      "connectionUri": "postgres://user:pass@localhost:5432/dbname",
      "action": "query",
      "sql": "SELECT id, email, created_at FROM users ORDER BY id DESC LIMIT 10;"
    }
  }
  ```
- For **SQLite** databases (`*.sqlite`, `*.db`), use `executeCommand` with `sqlite3 <db_file> ".schema"` or a Node.js (`better-sqlite3` / `sqlite3`) or Python (`sqlite3` stdlib) script.

## 2. Schema Design & Idempotent Migrations
- **Idempotent DDL**: Write SQL initialization scripts using `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` so re-running setup scripts never fails on existing tables.
- **Primary Keys, Foreign Keys & Timestamps**:
  - Include primary keys (`SERIAL PRIMARY KEY`, `BIGINT GENERATED ALWAYS AS IDENTITY`, or `INTEGER PRIMARY KEY AUTOINCREMENT` in SQLite).
  - Define explicit foreign key constraints (`REFERENCES parent_table(id) ON DELETE CASCADE`) and index foreign key columns.
  - Include `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP` on core entities.

## 3. Safe Querying & Connection Management
- **Parameterized Queries Only**: NEVER interpolate user input directly into SQL strings. Always use parameterized placeholders (`$1, $2` in `pg`, `?` in `mysql2`/`sqlite3`, `:param` or `%s` in Python DB-API).
- **Connection Pooling & Fallbacks**:
  - Read connection strings from `process.env.DATABASE_URL` with sensible local defaults.
  - Handle connection failures gracefully and expose database readiness in the application's `/health` endpoint.
