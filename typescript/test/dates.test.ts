import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate } from "../src/dates";

test("parses real dates to day numbers", () => {
  assert.equal(parseDate("1970-01-01"), 0);
  assert.equal(parseDate("1970-01-02"), 1);
  assert.equal(parseDate("2024-02-29"), parseDate("2024-02-28")! + 1); // leap year
});

test("day differences cross month, year and DST boundaries exactly", () => {
  assert.equal(parseDate("2026-10-12")! - parseDate("2026-09-30")!, 12);
  assert.equal(parseDate("2027-01-01")! - parseDate("2026-12-31")!, 1);
  assert.equal(parseDate("2026-03-30")! - parseDate("2026-03-28")!, 2); // EU DST change
  assert.equal(parseDate("2026-11-02")! - parseDate("2026-10-25")!, 8);
});

test("rejects dates that do not exist", () => {
  for (const s of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-01-00", "2100-02-29"]) {
    assert.equal(parseDate(s), null, s);
  }
});

test("rejects anything not exactly YYYY-MM-DD", () => {
  const bad: unknown[] = [
    "30/09/2026", "2026/09/30", "2026-9-30", "2026-09-3", "26-09-30", " 2026-09-30", "2026-09-30 ",
    "2026-09-30T00:00:00Z", "", "today", "２０２６-09-30", 20260930, null, undefined, true, {}, [],
  ];
  for (const v of bad) assert.equal(parseDate(v), null, JSON.stringify(v));
});
