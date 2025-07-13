-- Fix permissions for read_only role
-- This script should be run as the postgres superuser

-- Grant basic schema usage
GRANT USAGE ON SCHEMA public TO "read_only";

-- Grant SELECT permissions on tables
GRANT SELECT ON "article" TO "read_only";
GRANT SELECT ON "embedding" TO "read_only";

-- Grant EXECUTE permissions on all functions (including vector functions)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "read_only";

-- Grant usage on sequences (needed for serial columns)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "read_only";

-- Set default privileges for future functions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "read_only";
