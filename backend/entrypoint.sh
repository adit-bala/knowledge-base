#!/bin/sh
set -euo pipefail

echo "⏳ Running migrations with admin credentials..."
DATABASE_URL="$DATABASE_URL_ADMIN" npx drizzle-kit migrate

echo "✅ Migrations complete. Starting backend with RLS-enforced credentials."
exec node dist/server.js 