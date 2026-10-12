// Tests for the rules engine (README part 1). Run from inside typescript/:  npm test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { buildPlan } from "../src/plan";

const TODAY = "2026-10-12";

/** A valid unpaid invoice; override any field, or set it to undefined to remove it. */
function invoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: "INV-1",
    customer: "Example Ltd",
    email: "accounts@example.test",
    amount: 100,
    currency: "EUR",
    due_date: "2026-09-30",
    paid_date: null,
  };
  const result = { ...base, ...overrides };
  for (const key of Object.keys(result)) if (result[key] === undefined) delete result[key];
  return result;
}

/** A due date that is `days` before TODAY. */
function dueDaysAgo(days: number): string {
  const d = new Date(Date.UTC(2026, 9, 12 - days));
  return d.toISOString().slice(0, 10);
}

function sent(invoice_id: string, step: unknown) {
  return { invoice_id, step, sent_on: "2026-10-01" };
}

function stepFor(days: number, sentList: unknown[] = []) {
  const plan = buildPlan([invoice({ due_date: dueDaysAgo(days) })], sentList, TODAY);
  return plan.actions.length ? plan.actions[0].step : null;
}

function skipReason(overrides: Record<string, unknown>) {
  const plan = buildPlan([invoice(overrides)], [], TODAY);
  if (plan.skipped.length) assert.equal(plan.actions.length, 0, "a skipped invoice must not get an action");
  return plan.skipped.length ? plan.skipped[0].reason : null;
}

test("empty input gives an empty plan", () => {
  assert.deepEqual(buildPlan([], [], TODAY), { today: TODAY, actions: [], skipped: [] });
});

describe("steps by days overdue", () => {
  test("thresholds at 3, 10 and 24 days", () => {
    const expected: Array<[number, string | null]> = [
      [-30, null], [-1, null], [0, null], [1, null], [2, null],
      [3, "friendly"], [9, "friendly"],
      [10, "firm"], [23, "firm"],
      [24, "final"], [400, "final"],
    ];
    for (const [days, step] of expected) assert.equal(stepFor(days), step, `${days} days`);
  });

  test("action carries days overdue and approval flag", () => {
    const cases: Array<[number, boolean]> = [[3, false], [10, true], [24, true]];
    for (const [days, approval] of cases) {
      const [action] = buildPlan([invoice({ due_date: dueDaysAgo(days) })], [], TODAY).actions;
      assert.equal(action.days_overdue, days);
      assert.equal(action.needs_approval, approval);
    }
  });

  test("days overdue is counted in calendar days across months and years", () => {
    const [action] = buildPlan([invoice({ due_date: "2025-12-31" })], [], "2026-01-25").actions;
    assert.equal(action.days_overdue, 25);
    assert.equal(action.step, "final");
  });

  test("only the highest step is planned, one action per invoice", () => {
    const plan = buildPlan([invoice({ due_date: dueDaysAgo(30) })], [], TODAY);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].step, "final");
  });
});

describe("reminders already sent", () => {
  test("same step already sent plans nothing", () => {
    assert.equal(stepFor(5, [sent("INV-1", "friendly")]), null);
    assert.equal(stepFor(12, [sent("INV-1", "firm")]), null);
    assert.equal(stepFor(30, [sent("INV-1", "final")]), null);
  });

  test("a higher step already sent plans nothing", () => {
    assert.equal(stepFor(5, [sent("INV-1", "firm")]), null);
    assert.equal(stepFor(12, [sent("INV-1", "final")]), null);
  });

  test("a lower step already sent plans the step reached", () => {
    assert.equal(stepFor(12, [sent("INV-1", "friendly")]), "firm");
    assert.equal(stepFor(30, [sent("INV-1", "friendly"), sent("INV-1", "firm")]), "final");
    assert.equal(stepFor(30, [sent("INV-1", "friendly")]), "final");
  });

  test("order of sent entries does not matter", () => {
    assert.equal(stepFor(12, [sent("INV-1", "final"), sent("INV-1", "friendly")]), null);
  });

  test("entries for other invoices, unknown steps or bad shapes are ignored", () => {
    const noise = [
      sent("INV-2", "final"),
      sent("INV-1", "Final"),
      sent("INV-1", "reminder"),
      sent("INV-1", null),
      { invoice_id: 1, step: "final" },
      { step: "final" },
      null,
      "INV-1",
      ["INV-1", "final"],
    ];
    assert.equal(stepFor(12, noise), "firm");
  });

  test("sent_on is not used", () => {
    assert.equal(stepFor(12, [{ invoice_id: "INV-1", step: "friendly", sent_on: "garbage" }]), "firm");
    assert.equal(stepFor(12, [{ invoice_id: "INV-1", step: "firm" }]), null);
  });
});

describe("paid invoices", () => {
  test("paid on or before today plans nothing, even if reminders were sent", () => {
    for (const paid of ["2026-10-12", "2026-10-01", "2026-09-01"]) {
      const plan = buildPlan([invoice({ due_date: dueDaysAgo(30), paid_date: paid })], [sent("INV-1", "friendly")], TODAY);
      assert.deepEqual(plan, { today: TODAY, actions: [], skipped: [] }, paid);
    }
  });

  test("missing or null paid_date means unpaid", () => {
    assert.equal(buildPlan([invoice({ paid_date: undefined })], [], TODAY).actions.length, 1);
    assert.equal(buildPlan([invoice({ paid_date: null })], [], TODAY).actions.length, 1);
  });
});

describe("bad data", () => {
  test("invalid_amount", () => {
    for (const amount of [undefined, null, 0, -0, -5, "100", "", true, false, [100], { v: 1 }]) {
      assert.equal(skipReason({ amount }), "invalid_amount", JSON.stringify(amount));
    }
  });

  test("valid amounts are accepted", () => {
    for (const amount of [0.01, 1, 215.5, 1e9]) assert.equal(skipReason({ amount }), null, String(amount));
  });

  test("missing_due_date", () => {
    for (const due_date of [undefined, null, ""]) {
      assert.equal(skipReason({ due_date }), "missing_due_date", JSON.stringify(due_date));
    }
  });

  test("invalid_due_date", () => {
    for (const due_date of ["2026-02-30", "30/09/2026", "2026-9-30", " ", "soon", 20260930, true, {}]) {
      assert.equal(skipReason({ due_date }), "invalid_due_date", JSON.stringify(due_date));
    }
  });

  test("invalid_paid_date", () => {
    for (const paid_date of ["", "2026-02-30", "05/10/2026", "2026-10-13", "2027-01-01", false, 0, "null"]) {
      assert.equal(skipReason({ paid_date }), "invalid_paid_date", JSON.stringify(paid_date));
    }
  });

  test("a future due date is not bad data", () => {
    assert.equal(skipReason({ due_date: "2030-01-01" }), null);
  });

  test("first reason wins", () => {
    assert.equal(skipReason({ amount: 0, due_date: null, paid_date: "" }), "invalid_amount");
    assert.equal(skipReason({ due_date: null, paid_date: "" }), "missing_due_date");
    assert.equal(skipReason({ due_date: "2026-02-30", paid_date: "x" }), "invalid_due_date");
  });

  test("bad data is reported even when the invoice is paid or not yet due", () => {
    assert.equal(skipReason({ amount: -1, paid_date: "2026-10-01" }), "invalid_amount");
    assert.equal(skipReason({ amount: -1, due_date: "2030-01-01" }), "invalid_amount");
  });

  test("duplicate_id skips every copy, listed once, and beats other reasons", () => {
    const plan = buildPlan(
      [
        invoice({ id: "INV-7", due_date: dueDaysAgo(12) }),
        invoice({ id: "INV-7", amount: -1 }),
        invoice({ id: "INV-7", due_date: dueDaysAgo(30) }),
        invoice({ id: "INV-8", due_date: dueDaysAgo(12) }),
      ],
      [],
      TODAY,
    );
    assert.deepEqual(plan.skipped, [{ invoice_id: "INV-7", reason: "duplicate_id" }]);
    assert.deepEqual(plan.actions.map((a) => a.invoice_id), ["INV-8"]);
  });

  test("ids are compared exactly", () => {
    const plan = buildPlan([invoice({ id: "inv-1" }), invoice({ id: "INV-1" }), invoice({ id: "INV-1 " })], [], TODAY);
    assert.equal(plan.skipped.length, 0);
    assert.equal(plan.actions.length, 3);
  });
});

describe("output", () => {
  test("both lists are sorted by invoice id in plain text order", () => {
    const ids = ["INV-99", "INV-100", "B-1", "INV-1000", "a-1", "INV-10"];
    const plan = buildPlan(
      [...ids.map((id) => invoice({ id })), ...ids.map((id) => invoice({ id: `X${id}`, amount: 0 }))],
      [],
      TODAY,
    );
    const sorted = ["B-1", "INV-10", "INV-100", "INV-1000", "INV-99", "a-1"];
    assert.deepEqual(plan.actions.map((a) => a.invoice_id), sorted);
    assert.deepEqual(plan.skipped.map((s) => s.invoice_id), sorted.map((id) => `X${id}`));
  });

  test("action has exactly the documented fields", () => {
    const [action] = buildPlan([invoice()], [], TODAY).actions;
    assert.deepEqual(Object.keys(action).sort(), ["days_overdue", "invoice_id", "message", "needs_approval", "step"]);
  });

  test("does not change its inputs", () => {
    const invoices = [invoice({ id: "B" }), invoice({ id: "A" })];
    const sentList = [sent("A", "friendly")];
    const before = JSON.stringify([invoices, sentList]);
    buildPlan(invoices, sentList, TODAY);
    assert.equal(JSON.stringify([invoices, sentList]), before);
  });

  test("rejects an invalid today", () => {
    assert.throws(() => buildPlan([], [], "2026-02-30"));
    assert.throws(() => buildPlan([], [], "12/10/2026"));
  });
});

test("sample data gives the expected plan", () => {
  const invoices = JSON.parse(readFileSync(new URL("../../data/invoices.json", import.meta.url), "utf-8"));
  const sentList = JSON.parse(readFileSync(new URL("../../data/sent.json", import.meta.url), "utf-8"));
  const plan = buildPlan(invoices, sentList, TODAY);
  assert.deepEqual(
    plan.actions.map(({ invoice_id, step, needs_approval, days_overdue }) => ({ invoice_id, step, needs_approval, days_overdue })),
    [
      { invoice_id: "INV-1001", step: "firm", needs_approval: true, days_overdue: 12 },
      { invoice_id: "INV-1002", step: "friendly", needs_approval: false, days_overdue: 3 },
      { invoice_id: "INV-1004", step: "final", needs_approval: true, days_overdue: 32 },
      { invoice_id: "INV-1009", step: "firm", needs_approval: true, days_overdue: 12 },
      { invoice_id: "INV-1011", step: "firm", needs_approval: true, days_overdue: 10 },
    ],
  );
  assert.deepEqual(plan.skipped, [
    { invoice_id: "INV-1007", reason: "invalid_due_date" },
    { invoice_id: "INV-1008", reason: "missing_due_date" },
    { invoice_id: "INV-1010", reason: "duplicate_id" },
  ]);
});
