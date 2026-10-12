// Tests for the reminder messages (README part 3).

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildMessage, checkMessage, formatAmount, type MessageFacts } from "../src/messages";
import { buildPlan, type Step } from "../src/rules";

const STEPS: Step[] = ["friendly", "firm", "final"];

function facts(overrides: Partial<MessageFacts> = {}): MessageFacts {
  return {
    step: "friendly",
    customer: "Alder Fabrication Ltd",
    invoiceId: "INV-1001",
    amount: 1250,
    currency: "EUR",
    dueDate: "2026-09-30",
    daysOverdue: 12,
    ...overrides,
  };
}

describe("formatAmount", () => {
  test("currency and exactly 2 decimals", () => {
    assert.equal(formatAmount(1250, "EUR"), "EUR 1250.00");
    assert.equal(formatAmount(215.5, "EUR"), "EUR 215.50");
    assert.equal(formatAmount(845.25, "USD"), "USD 845.25");
    assert.equal(formatAmount(0.01, "EUR"), "EUR 0.01");
    assert.equal(formatAmount(99.999, "EUR"), "EUR 100.00");
    assert.equal(formatAmount(1000000, "GBP"), "GBP 1000000.00");
  });
});

describe("every message follows the rules", () => {
  const tricky: Array<Partial<MessageFacts>> = [
    {},
    { customer: "3M Partners 2024 Ltd" }, // digits in the name
    { customer: "Interest & Fees Consulting" }, // forbidden words in the name
    { customer: 'Smith <b>"Co"</b>' },
    { invoiceId: "INV-2026-10-01" }, // looks like a date
    { invoiceId: "12" }, // same as the days overdue
    { amount: 0.01 },
    { amount: 215.5 },
    { amount: 1e9 },
    { currency: "USD", amount: 845.25 },
    { daysOverdue: 3 },
    { daysOverdue: 24 },
    { daysOverdue: 400 },
    { dueDate: "2024-02-29" },
  ];
  for (const step of STEPS) {
    for (const t of tricky) {
      test(`${step} ${JSON.stringify(t)}`, () => {
        const f = facts({ ...t, step });
        assert.deepEqual(checkMessage(buildMessage(f), f), []);
      });
    }
  }
});

describe("tone fits the step", () => {
  const text = (step: Step) => buildMessage(facts({ step }));

  test("friendly is gentle", () => {
    assert.match(text("friendly"), /friendly reminder/);
    assert.match(text("friendly"), /overlooked/);
    assert.doesNotMatch(text("friendly"), /final|immediately/i);
  });

  test("firm asks for prompt payment", () => {
    assert.match(text("firm"), /promptly/);
    assert.doesNotMatch(text("firm"), /friendly|final/i);
  });

  test("final is a final notice", () => {
    assert.match(text("final"), /final notice/);
    assert.match(text("final"), /immediately/);
    assert.doesNotMatch(text("final"), /friendly/i);
  });

  test("each step has its own text", () => {
    assert.equal(new Set(STEPS.map(text)).size, 3);
  });

  test("greets the customer and has no line with a placeholder", () => {
    for (const step of STEPS) {
      const message = text(step);
      assert.ok(message.startsWith("Dear Alder Fabrication Ltd,"));
      assert.doesNotMatch(message, /undefined|null|NaN|\$\{/);
    }
  });
});

describe("checkMessage catches bad text", () => {
  const f = facts();
  const good = buildMessage(f);

  const bad: Array<[string, string, RegExp]> = [
    ["missing amount", good.replace("EUR 1250.00", "the amount"), /missing amount/],
    ["wrong decimals", good.replace("EUR 1250.00", "EUR 1250"), /missing amount/],
    ["missing customer", good.replace("Alder Fabrication Ltd", "customer"), /missing customer/],
    ["missing invoice id", good.replace("INV-1001", "your invoice"), /missing invoice id/],
    ["missing due date", good.replace("2026-09-30", "last month"), /missing due date/],
    ["missing days", good.replace("12 days overdue", "overdue"), /missing days overdue/],
    ["date in another form", good.replace("2026-09-30", "30/09/2026"), /missing due date/],
    ["late fee", good + "\n\nA late fee of 25 EUR will be added.", /figure|fee/],
    ["interest", good + "\n\nInterest will be added.", /interest/i],
    ["charged", good + "\n\nThis will be charged to you.", /charged/],
    ["percentage", good + "\n\nWe add eight % per year.", /%/],
    ["made-up deadline", good + "\n\nPlease pay within seven days.", /within/],
    ["another figure", good + "\n\nPlease pay by 2026-10-31.", /figure/],
    ["earlier reminder", good + "\n\nWe wrote to you previously about this.", /previous/],
    ["reminds again", good + "\n\nWe are writing again.", /again/],
    ["legal threat", good + "\n\nWe will start legal action.", /legal/],
    ["ECB rate", good + "\n\nThe ECB rate applies.", /ECB/],
  ];
  for (const [name, message, problem] of bad) {
    test(name, () => {
      const problems = checkMessage(message, f);
      assert.ok(problems.some((p) => problem.test(p)), `${name}: ${JSON.stringify(problems)}`);
    });
  }
});

test("plan actions carry the message for their step", () => {
  const plan = buildPlan(
    [{ id: "INV-9", customer: "Copperleaf Catering", amount: 3200, currency: "EUR", due_date: "2026-09-10", paid_date: null }],
    [],
    "2026-10-12",
  );
  const [action] = plan.actions;
  assert.equal(action.step, "final");
  const f = facts({ step: "final", customer: "Copperleaf Catering", invoiceId: "INV-9", amount: 3200, dueDate: "2026-09-10", daysOverdue: 32 });
  assert.equal(action.message, buildMessage(f));
  assert.deepEqual(checkMessage(action.message, f), []);
});
