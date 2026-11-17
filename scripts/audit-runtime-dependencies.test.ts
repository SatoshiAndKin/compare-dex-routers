import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAudit } from "./audit-runtime-dependencies.js";

const advisory = {
  github_advisory_id: "GHSA-fixture",
  module_name: "example-library",
  severity: "high",
  findings: [{ version: "1.0.0" }, { version: "2.0.0" }],
};
const report = {
  advisories: { "1": advisory },
  metadata: { vulnerabilities: { high: 1, critical: 0 } },
};

test("blocks the shipped affected version and warns about the unshipped version", () => {
  const [result] = classifyAudit(report, new Set(["example-library@2.0.0"]));
  assert.deepEqual(result.shipped, ["example-library@2.0.0"]);
  assert.deepEqual(result.unshipped, ["example-library@1.0.0"]);
});

test("warns when only unaffected versions ship", () => {
  const [result] = classifyAudit(report, new Set(["example-library@3.0.0"]));
  assert.deepEqual(result.shipped, []);
  assert.deepEqual(result.unshipped, ["example-library@1.0.0", "example-library@2.0.0"]);
});

test("treats an emitted package with unknown version as affected", () => {
  const [result] = classifyAudit(report, new Set(["example-library@*"]));
  assert.deepEqual(result.shipped, ["example-library@1.0.0", "example-library@2.0.0"]);
  assert.deepEqual(result.unshipped, []);
});

test("rejects missing advisory or version evidence", () => {
  assert.throws(() => classifyAudit({ ...report, advisories: {} }, new Set()), /incomplete/);
  const incomplete = { ...report, advisories: { "1": { ...advisory, findings: [] } } };
  assert.throws(() => classifyAudit(incomplete, new Set()), /no package name or version/);
});
