import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { renderEFacturaXml } from "../cube/efactura/index.ts"
import { syntheticFixtures } from "../cube/efactura/fixtures.test-support.ts"

/**
 * Writes the synthetic e-Factura fixtures to disk so they can be uploaded to
 * ANAF's public validator.
 *
 * Every document is invented — see cube/efactura/fixtures.test-support.ts. No
 * real invoice ever goes through here: the validator is a third-party service
 * and an uploaded document is out of our hands.
 *
 * Usage: node scripts/efactura-fixtures.mjs [output-directory]
 */

const outputDirectory = resolve(process.argv[2] ?? ".local/efactura-fixtures")
mkdirSync(outputDirectory, { recursive: true })

for (const fixture of syntheticFixtures) {
  const path = join(outputDirectory, `${fixture.name}.xml`)
  writeFileSync(path, renderEFacturaXml(fixture.document), "utf8")
  console.log(path)
}
