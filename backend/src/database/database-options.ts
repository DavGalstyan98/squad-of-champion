import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions'
import { InitialSchema1791192000000 } from './migrations/1791192000000-InitialSchema'
import { QueryIndexes1791192000001 } from './migrations/1791192000001-QueryIndexes'

export function databaseOptions(url: string): PostgresConnectionOptions {
  return {
    type: 'postgres',
    url,
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    migrationsTableName: 'schema_migrations',
    migrations: [InitialSchema1791192000000, QueryIndexes1791192000001],
    entities: [],
    logging: false,
    extra: { connectionTimeoutMillis: 5000 },
  }
}
