// Thin vitest wrapper around vlm-judge.ts: regenerates the report on test
// invocation so re-runs against fresh TEIs are one `npm test -- vlm-judge`
// away. The report itself is committed under test/bench/vlm-judge-report.md.

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runVlmJudge, writeReport } from "./vlm-judge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.resolve(here, "../../fixtures/external-corpus");
const truthDir = path.join(corpusDir, "vlm-truth");
const grobidJsDir = path.join(corpusDir, "grobid-js");
const upstreamDir = path.join(corpusDir, "upstream");

const haveInputs =
  existsSync(truthDir) &&
  existsSync(grobidJsDir) &&
  existsSync(upstreamDir) &&
  readdirSync(truthDir).some((f) => f.endsWith(".json")) &&
  readdirSync(grobidJsDir).some((f) => f.endsWith(".tei.xml")) &&
  readdirSync(upstreamDir).some((f) => f.endsWith(".tei.xml"));

const runIfReady = haveInputs ? describe : describe.skip;

runIfReady("vlm-judge", () => {
  it("writes the report and produces rows for every truth file", () => {
    const truthCount = readdirSync(truthDir).filter((f) => f.endsWith(".json")).length;
    const { rows } = runVlmJudge();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(truthCount);
    writeReport();
  });
});
