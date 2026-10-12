// Tests for the command line: arguments, files and exit codes.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { run } from "../src/plan";

const dir = mkdtempSync(join(tmpdir(), "plan-cli-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

const invoices = file(
  "invoices.json",
  JSON.stringify([{ id: "INV-1", customer: "A", amount: 10, currency: "EUR", due_date: "2026-09-30", paid_date: null }]),
);
const sent = file("sent.json", "[]");

/** Run the command with console.error silenced; returns the exit code and what was printed. */
function runQuiet(args: string[]): { code: number; stderr: string } {
  const original = console.error;
  let stderr = "";
  console.error = (...parts: unknown[]) => {
    stderr += parts.join(" ") + "\n";
  };
  try {
    return { code: run(args), stderr };
  } finally {
    console.error = original;
  }
}

test("writes the plan and exits 0", () => {
  const out = join(dir, "out.json");
  const { code } = runQuiet(["--invoices", invoices, "--sent", sent, "--today", "2026-10-12", "--out", out]);
  assert.equal(code, 0);
  const plan = JSON.parse(readFileSync(out, "utf-8"));
  assert.equal(plan.today, "2026-10-12");
  assert.equal(plan.actions[0].step, "firm");
  assert.deepEqual(plan.skipped, []);
});

test("invalid --today exits non zero with a clear message", () => {
  for (const today of ["2026-02-30", "12/10/2026", "", "tomorrow"]) {
    const { code, stderr } = runQuiet(["--invoices", invoices, "--sent", sent, "--today", today, "--out", join(dir, "x.json")]);
    assert.notEqual(code, 0, today);
    assert.match(stderr, /today/, today);
  }
});

test("unreadable or malformed files exit non zero with a clear message", () => {
  const cases: Array<[string, RegExp]> = [
    [join(dir, "does-not-exist.json"), /Cannot read invoices/],
    [file("broken.json", "[{"), /not valid JSON/],
    [file("object.json", '{"id": "INV-1"}'), /must contain a JSON list/],
  ];
  for (const [path, message] of cases) {
    const { code, stderr } = runQuiet(["--invoices", path, "--sent", sent, "--today", "2026-10-12", "--out", join(dir, "x.json")]);
    assert.notEqual(code, 0, path);
    assert.match(stderr, message, path);
  }
  const { code, stderr } = runQuiet(["--invoices", invoices, "--sent", join(dir, "nope.json"), "--today", "2026-10-12", "--out", join(dir, "x.json")]);
  assert.notEqual(code, 0);
  assert.match(stderr, /Cannot read sent/);
});

test("missing or unknown arguments exit non zero with usage", () => {
  assert.notEqual(runQuiet(["--invoices", invoices]).code, 0);
  const { code, stderr } = runQuiet(["--bogus", "x"]);
  assert.notEqual(code, 0);
  assert.match(stderr, /Usage/);
});

test("accepts a file that starts with a byte order mark", () => {
  const bom = file("bom.json", "﻿[]");
  const out = join(dir, "bom-out.json");
  assert.equal(runQuiet(["--invoices", bom, "--sent", bom, "--today", "2026-10-12", "--out", out]).code, 0);
});
