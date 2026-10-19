import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { URL } from "node:url"
import test from "node:test"

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8")
const runbooks = ["README.md", "docs/RELEASE.md", "docs/LOCAL_DEVELOPMENT.md"]

/** Shell commands of a markdown file, with `\` continuations joined into one line. */
const commands = (markdown) => markdown.replace(/\\\n\s*/gu, " ").split("\n").map((line) => line.trim())

void test("no backup or restore `run` starts the migrate service first", () => {
  // `docker compose run` starts the service's dependencies, `migrate` included, unless
  // `--no-deps`: the schema would change before the backup exists or under the restore.
  for (const name of runbooks) {
    const runs = commands(source(name)).filter((line) => /docker compose .*\brun\b/u.test(line) && /\b(?:backup|restore) --/u.test(line))
    assert.ok(runs.length > 0, `${name} documents backup or restore`)
    for (const line of runs) assert.match(line, /\brun --rm --no-deps\b/u, `${name}: ${line}`)
  }
})

void test("the upgrade backs up with the running version before the new one is pulled or started", () => {
  const sections = [["docs/RELEASE.md", "## Upgrade\n"], ["README.md", "## Upgrading\n"]]
  const steps = [/stop app/u, /backup --output/u, /compose\.prod\.yaml pull/u, /compose\.prod\.yaml (?:--profile proxy )?up -d/u]
  for (const [name, heading] of sections) {
    const upgrade = source(name).split(heading)[1]?.split("\n## ")[0] ?? ""
    const order = steps.map((step) => upgrade.search(step))
    assert.ok(order.every((index) => index >= 0), `${name}: every step is documented`)
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${name}: stop, back up, pull, start`)
  }
})

void test("health is checked on /health/ready, never on the /healthz alias", () => {
  for (const name of runbooks) assert.doesNotMatch(source(name), /\/healthz\b/u, name)
})
