import assert from "node:assert/strict"
import test from "node:test"

import { Effect, Redacted } from "effect"

import { classifyUpload, classifyValidation } from "../../../cubes/invoicing/efactura/submissions/index.ts"
import { startFakeAnaf } from "./fake-anaf.test-support.ts"
import { createSubmissionGateway } from "./submission-gateway.ts"

const xml = new TextEncoder().encode("<Invoice/>")
const token = Redacted.make("access-1")

for (const environment of ["test", "prod"] as const) {
  void test(`on ${environment}, validare goes to the public validator without a token; the upload stays on api.anaf.ro with it`, async () => {
    const fake = await startFakeAnaf()
    try {
      const gateway = createSubmissionGateway(environment, fake.transport)
      assert.deepEqual(classifyValidation(await Effect.runPromise(gateway.validate("UBL", xml))), { kind: "valid" })
      assert.deepEqual(classifyValidation(await Effect.runPromise(gateway.validate("CN", xml))), { kind: "valid" })
      assert.equal(classifyUpload(await Effect.runPromise(gateway.upload(token, "UBL", "12345674", xml))).kind, "indexed")
      assert.deepEqual(fake.calls.map(({ method, origin, path, authorization }) => [`${method} ${origin}${path}`, authorization]), [
        ["POST https://webservicesp.anaf.ro/prod/FCTEL/rest/validare/FACT1", undefined],
        ["POST https://webservicesp.anaf.ro/prod/FCTEL/rest/validare/FCN", undefined],
        [`POST https://api.anaf.ro/${environment}/FCTEL/rest/upload?standard=UBL&cif=12345674`, "Bearer access-1"],
      ])
      assert.ok(fake.calls.every((call) => call.body.toString("utf8") === "<Invoice/>"), "the XML is the body of both calls")
    } finally {
      await fake.close()
    }
  })
}
