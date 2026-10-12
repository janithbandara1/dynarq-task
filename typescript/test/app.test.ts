// Tests for the owner's page (part 2): a real server on a free port, with temporary data.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApp, type Decisions } from "../src/app";
import { REASON_TEXT } from "../src/page";

const TODAY = "2026-10-12";
const tempDirs: string[] = [];
after(() => tempDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function dataDir(invoices: unknown, sent: unknown = []): string {
  const dir = mkdtempSync(join(tmpdir(), "plan-app-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "invoices.json"), typeof invoices === "string" ? invoices : JSON.stringify(invoices));
  writeFileSync(join(dir, "sent.json"), JSON.stringify(sent));
  return dir;
}

function inv(id: string, due_date: unknown, extra: Record<string, unknown> = {}) {
  return { id, customer: `Customer ${id}`, amount: 1250, currency: "EUR", due_date, paid_date: null, ...extra };
}

/** Start an app, run `fn` against its base URL, then stop it. */
async function withApp(dir: string, fn: (base: string) => Promise<void>, today = TODAY, decisions?: Decisions): Promise<void> {
  const server = createApp({ dataDir: dir, today }, decisions);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function decide(base: string, fields: Record<string, string>) {
  return fetch(`${base}/decide`, { method: "POST", body: new URLSearchParams(fields), redirect: "manual" });
}

const SAMPLE = [
  inv("INV-1", "2026-09-30"), // 12 days: firm
  inv("INV-2", "2026-10-09"), // 3 days: friendly
  inv("INV-3", "2026-02-30"), // invalid_due_date
];

test("shows today's plan with customer, invoice, amount, days, step and message", async () => {
  await withApp(dataDir(SAMPLE), async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    const html = await res.text();
    for (const text of ["Customer INV-1", "INV-1", "EUR 1250.00", "12 days", "Firm reminder", "Friendly reminder", "3 days"]) {
      assert.ok(html.includes(text), text);
    }
    assert.ok(html.includes("Waiting for your decision"));
    assert.ok(html.includes("No approval needed"));
    assert.match(html, /<p class="message">Dear Customer INV-1/);
  });
});

test("skipped invoices are explained in plain words, not codes", async () => {
  await withApp(dataDir(SAMPLE), async (base) => {
    const html = await (await fetch(base + "/")).text();
    assert.ok(html.includes(REASON_TEXT.invalid_due_date.split(".")[0]));
    assert.ok(!html.includes("invalid_due_date"));
  });
});

test("approve and reject are recorded and shown, and can be changed", async () => {
  await withApp(dataDir(SAMPLE), async (base) => {
    let res = await decide(base, { invoice_id: "INV-1", step: "firm", decision: "approved" });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/#invoice-INV-1");
    let html = await (await fetch(base + "/")).text();
    assert.ok(html.includes('<span class="badge approved">Approved</span>'));
    assert.ok(html.includes("Change to reject"));
    assert.ok(html.includes("0 waiting for your decision"));

    res = await decide(base, { invoice_id: "INV-1", step: "firm", decision: "rejected" });
    assert.equal(res.status, 303);
    html = await (await fetch(base + "/")).text();
    assert.ok(html.includes('<span class="badge rejected">Rejected</span>'));
  });
});

test("a decision for one step does not carry over to the next step", async () => {
  const sent = [{ invoice_id: "INV-1", step: "friendly", sent_on: "2026-10-01" }];
  const dir = dataDir([inv("INV-1", "2026-09-30")], sent);
  const decisions = new Map();
  await withApp(dir, async (base) => {
    await decide(base, { invoice_id: "INV-1", step: "firm", decision: "approved" });
    assert.ok((await (await fetch(base + "/")).text()).includes("badge approved"));
  }, TODAY, decisions);
  // 12 days later the same invoice reaches "final": the earlier approval must not apply to it.
  await withApp(dir, async (base) => {
    const html = await (await fetch(base + "/")).text();
    assert.ok(html.includes("Final notice"));
    assert.ok(html.includes("Waiting for your decision"));
    assert.ok(!html.includes("badge approved"));
  }, "2026-10-24", decisions);
});

test("decisions that do not match a reminder needing approval are refused", async () => {
  await withApp(dataDir(SAMPLE), async (base) => {
    const cases: Array<[Record<string, string>, number]> = [
      [{ invoice_id: "INV-2", step: "friendly", decision: "approved" }, 409], // needs no approval
      [{ invoice_id: "INV-9", step: "firm", decision: "approved" }, 409], // not in the plan
      [{ invoice_id: "INV-1", step: "final", decision: "approved" }, 409], // wrong step
      [{ invoice_id: "INV-1", step: "firm", decision: "maybe" }, 400],
      [{}, 400],
    ];
    for (const [fields, status] of cases) {
      const res = await decide(base, fields);
      assert.equal(res.status, status, JSON.stringify(fields));
      assert.match(await res.text(), /role="alert"/);
    }
    const html = await (await fetch(base + "/")).text();
    assert.ok(!html.includes("badge approved"));
  });
});

test("explains when there is nothing to do", async () => {
  await withApp(dataDir([inv("INV-1", "2026-10-11"), inv("INV-2", "2026-09-01", { paid_date: "2026-09-05" })]), async (base) => {
    const html = await (await fetch(base + "/")).text();
    assert.ok(html.includes("Nothing to do today"));
    assert.ok(html.includes("All invoices could be checked"));
  });
  await withApp(dataDir([]), async (base) => {
    assert.ok((await (await fetch(base + "/")).text()).includes("Nothing to do today"));
  });
});

test("explains when the data cannot be read", async () => {
  const missing = mkdtempSync(join(tmpdir(), "plan-app-empty-"));
  tempDirs.push(missing);
  for (const dir of [missing, dataDir("[{ not json"), dataDir('{"id": 1}')]) {
    await withApp(dir, async (base) => {
      const res = await fetch(base + "/");
      assert.equal(res.status, 500);
      const html = await res.text();
      assert.ok(html.includes("The invoice data cannot be read"));
      assert.ok(html.includes("No reminders are shown until this is fixed"));
    });
  }
});

test("explains an invalid TODAY setting", async () => {
  await withApp(dataDir(SAMPLE), async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 500);
    assert.ok((await res.text()).includes("The date setting is not valid"));
  }, "2026-02-30");
});

test("customer text is escaped", async () => {
  const evil = inv("INV-<1>", "2026-09-30", { customer: '<script>alert("x")</script>' });
  await withApp(dataDir([evil]), async (base) => {
    const html = await (await fetch(base + "/")).text();
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });
});

test("page works on a phone and with the keyboard", async () => {
  await withApp(dataDir(SAMPLE), async (base) => {
    const html = await (await fetch(base + "/")).text();
    assert.ok(html.includes('name="viewport" content="width=device-width, initial-scale=1"'));
    assert.ok(html.includes(":focus-visible"));
    assert.match(html, /<button class="approve"[^>]*aria-label="Approve firm reminder for INV-1"/);
    assert.ok(!/tabindex="-?\d+"/.test(html));
  });
});

test("unknown pages give 404 and wrong methods 405", async () => {
  await withApp(dataDir(SAMPLE), async (base) => {
    assert.equal((await fetch(base + "/nope")).status, 404);
    assert.equal((await fetch(base + "/decide")).status, 405);
    assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
  });
});
