import { createDataSource } from './data-source'

async function main(): Promise<void> {
  const action = process.argv[2]
  if (!['run', 'show', 'revert'].includes(action ?? '')) {
    throw new Error('Usage: migration-command.ts run|show|revert')
  }
  const database = await createDataSource().initialize()
  const lock = database.createQueryRunner()
  try {
    await lock.connect()
    // Hold a session lock while TypeORM executes migrations on its own connection.
    await lock.query('SELECT pg_advisory_lock(360, 0)')
    if (action === 'run') {
      const migrations = await database.runMigrations()
      console.log(`Applied ${migrations.length} migration(s)`)
    } else if (action === 'revert') {
      await database.undoLastMigration()
      console.log('Reverted latest migration, if present')
    } else {
      const pending = await database.showMigrations()
      const applied: unknown = await database.query(
        'SELECT timestamp, name FROM schema_migrations ORDER BY id',
      )
      console.log({ pending, applied })
    }
  } finally {
    try {
      await lock.query('SELECT pg_advisory_unlock(360, 0)')
    } finally {
      await lock.release()
      await database.destroy()
    }
  }
}

main().catch(() => {
  console.error('Migration command failed. Check database connectivity and migration state.')
  process.exitCode = 1
})
