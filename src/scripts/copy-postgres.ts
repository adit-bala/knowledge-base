import {spawn} from 'node:child_process';

// Simple script to stream data from a source Postgres database into a destination Postgres database.
//
// Usage examples:
//   npx tsx src/scripts/copy-postgres.ts \
//     --source=postgresql://postgres:postgres@localhost:5432/notion \
//     --dest=postgresql://postgres:postgres@localhost:5433/notion
//
// Environment variables can be used instead of CLI flags:
//   SOURCE_DATABASE_URL   Connection string for the source database
//   DEST_DATABASE_URL     Connection string for the destination database
//   DATABASE_URL_ADMIN    Fallback destination when DEST_DATABASE_URL is not provided
//
// The script relies on the `pg_dump` and `psql` (PostgreSQL client) binaries being available
// in the execution environment (locally or within CI, e.g. GitHub Actions).

/**
 * Parse a CLI flag in the form of `--key=value` and return the value if present.
 */
function getFlag(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find(a => a.startsWith(prefix));
  return arg ? arg.substring(prefix.length) : undefined;
}

/**
 * Drop and recreate the destination database to ensure a clean slate.
 */
function resetDestinationDatabase(destUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Extract database name from URL
    const dbName = destUrl.split('/').pop()?.split('?')[0] || 'notion';
    const baseUrl = destUrl.replace(`/${dbName}`, '/postgres');

    console.log(`🗑️  Dropping and recreating database: ${dbName}`);

    // Run DROP and CREATE separately to avoid transaction block issues
    const dropProc = spawn(
      'psql',
      [baseUrl, '-c', `DROP DATABASE IF EXISTS ${dbName};`],
      {
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );

    dropProc.on('error', err => {
      console.error('Failed to drop destination database:', err);
      reject(err);
    });

    dropProc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Database drop failed with code ${code}`));
        return;
      }

      // Now create the database
      const createProc = spawn(
        'psql',
        [baseUrl, '-c', `CREATE DATABASE ${dbName};`],
        {
          stdio: ['ignore', 'inherit', 'inherit'],
        },
      );

      createProc.on('error', err => {
        console.error('Failed to create destination database:', err);
        reject(err);
      });

      createProc.on('close', code => {
        if (code !== 0) {
          reject(new Error(`Database creation failed with code ${code}`));
        } else {
          console.log(`✅ Database ${dbName} reset successfully`);
          resolve();
        }
      });
    });
  });
}

/**
 * Run migrations on the destination database to create the schema.
 */
function runMigrations(destUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('🔄 Running migrations to create schema...');

    const migrateProc = spawn('npx', ['drizzle-kit', 'migrate'], {
      env: {...process.env, DATABASE_URL: destUrl},
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: './backend',
    });

    migrateProc.on('error', err => {
      console.error('Failed to run migrations:', err);
      reject(err);
    });

    migrateProc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Migrations failed with code ${code}`));
      } else {
        console.log('✅ Migrations completed successfully');
        resolve();
      }
    });
  });
}

const sourceUrl = getFlag('source') || process.env.SOURCE_DATABASE_URL || '';
const destUrl =
  getFlag('dest') ||
  process.env.DEST_DATABASE_URL ||
  process.env.DATABASE_URL_ADMIN ||
  '';

if (!sourceUrl || !destUrl) {
  throw new Error(
    'ERROR: `SOURCE_DATABASE_URL` (or --source) and `DEST_DATABASE_URL` / `DATABASE_URL_ADMIN` (or --dest) must be provided.',
  );
}

console.log(`📤 Dumping data from: ${sourceUrl}`);
console.log(`📥 Restoring data to: ${destUrl}`);

// Reset destination database first
resetDestinationDatabase(destUrl)
  .then(() => {
    // Run migrations on the destination database
    return runMigrations(destUrl);
  })
  .then(() => {
    // Spawn pg_dump (data-only) and pipe directly into psql connected to destination.
    const dumpProc = spawn(
      'pg_dump',
      [
        '--no-owner',
        '--no-privileges',
        '--data-only',
        '--exclude-table-data',
        'drizzle.__drizzle_migrations',
        '--dbname',
        sourceUrl,
      ],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );

    const restoreProc = spawn('psql', [destUrl], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    // Connect the STDOUT of pg_dump to the STDIN of psql.
    dumpProc.stdout.pipe(restoreProc.stdin);

    function terminate(code: number) {
      dumpProc.kill('SIGTERM');
      restoreProc.kill('SIGTERM');
      if (code === 0) {
        return;
      }
      throw new Error(`terminated with exit code ${code}`);
    }

    dumpProc.on('error', err => {
      console.error('Failed to start pg_dump:', err);
      terminate(1);
    });

    restoreProc.on('error', err => {
      console.error('Failed to start psql:', err);
      terminate(1);
    });

    restoreProc.on('close', code => {
      if (code !== 0) {
        console.error(`psql exited with code ${code}`);
        terminate(code ?? 1);
      } else {
        console.log('✅ Data copy completed successfully.');
      }
    });
  })
  .catch(err => {
    console.error('Failed to reset destination database:', err);
    throw err;
  });
