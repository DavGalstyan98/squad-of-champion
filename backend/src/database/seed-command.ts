import { createDataSource } from './data-source'
import { parseSource, readSource } from './seed-source'
import { seedCatalogue } from './seed'

async function main(): Promise<void> {
  // CLI intentionally accepts no path override: always seed the canonical file.
  const raw = await readSource()
  parseSource(raw)
  const database = await createDataSource().initialize()
  try {
    console.log(await seedCatalogue(database, raw))
  } finally {
    await database.destroy()
  }
}

main().catch((error: unknown) => {
  // Validation errors contain paths only; database exceptions can contain secrets.
  const message =
    error instanceof Error &&
    /^(Invalid character source|Character source|Source removes|Catalogue state)/.test(
      error.message,
    )
      ? error.message
      : 'Check source availability, database connectivity and migrations'
  console.error(`Seed failed: ${message}`)
  process.exitCode = 1
})
