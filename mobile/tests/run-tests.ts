import assert from "node:assert/strict";

import { classify } from "../src/core/classify";
import { extractFields } from "../src/core/extract";
import { defaultSettings, piLogic } from "../src/core/settings";

let passed = 0;
let failed = 0;

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (error) {
    console.error(`❌ FAIL: ${name}`);
    console.error(error);
    failed++;
  }
}

run("piLogic converts short PI codes to full format", () => {
  const converted = piLogic.convert("mustbrun12345", "FULL", defaultSettings);
  assert.equal(converted, "02PI201234500");
});

run("classify detects ServiceNow ticket codes", () => {
  const result = classify(" ritm0012345 ", defaultSettings);
  assert.deepEqual(result, {
    profileId: "auto",
    type: "RITM",
    normalized: "RITM0012345",
    piMode: "N/A",
  });
});

run("extractFields returns template matches before fallback rules", () => {
  const fields = extractFields("Ticket PI-77 para cliente ACME", [
    {
      id: "template-1",
      name: "PI template",
      type: "PI",
      regexRules: {
        ticketNumber: "(PI-\\d+)",
        customerId: "cliente\\s+([A-Z]+)",
      },
      mappingRules: {},
      samplePayloads: [],
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(fields, {
    ticketNumber: "PI-77",
    customerId: "ACME",
    _templateId: "template-1",
  });
});

run("extractFields fallback captures email and phone", () => {
  const fields = extractFields(
    "Contacto: maria@example.com Tel +34 600 111 222",
    []
  );

  assert.equal(fields.email, "maria@example.com");
  assert.equal(fields.phoneNumber, "+34 600 111 222");
});

console.log("\n-------------------");
console.log(`Tests completados.`);
console.log(`Pasaron: ${passed}`);
console.log(`Fallaron: ${failed}`);
console.log("-------------------");
if (failed > 0) process.exit(1);
