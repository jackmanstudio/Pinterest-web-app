#!/usr/bin/env bash
# Runs all migrations + RLS tests against a throwaway Postgres database.
# Usage: DATABASE_URL=postgres://postgres@localhost:5432/postgres scripts/test-db.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to an empty Postgres server (superuser)}"
DB="pas_test_$$"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "create database $DB"
trap 'psql "$DATABASE_URL" -q -c "drop database if exists $DB" >/dev/null' EXIT
BASE="${DATABASE_URL%%\?*}"
QUERY=""
[[ "$DATABASE_URL" == *\?* ]] && QUERY="?${DATABASE_URL#*\?}"
URL="${BASE%/*}/$DB$QUERY"
psql "$URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "migrate: $f"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/10_rls_test.sql
