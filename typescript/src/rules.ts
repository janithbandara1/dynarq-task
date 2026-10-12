// The rules engine (part 1): turns invoices, sent reminders and a date into a plan.
// Pure: no file access, no clock. The command line and the page both call buildPlan.

import { parseDate } from "./dates";
import { buildMessage } from "./messages";

export type Step = "friendly" | "firm" | "final";

export type SkipReason =
  | "duplicate_id"
  | "invalid_amount"
  | "missing_due_date"
  | "invalid_due_date"
  | "invalid_paid_date";

/** Steps from lowest to highest, with the days overdue at which each is reached. */
export const STEPS: ReadonlyArray<{ step: Step; minDays: number; needsApproval: boolean }> = [
  { step: "friendly", minDays: 3, needsApproval: false },
  { step: "firm", minDays: 10, needsApproval: true },
  { step: "final", minDays: 24, needsApproval: true },
];

export interface Action {
  invoice_id: string;
  step: Step;
  needs_approval: boolean;
  days_overdue: number;
  message: string;
}

export interface Skipped {
  invoice_id: string;
  reason: SkipReason;
}

export interface Plan {
  today: string;
  actions: Action[];
  skipped: Skipped[];
}

/** An invoice that passed every data check. */
interface ValidInvoice {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  dueDate: string;
  dueDay: number;
  paidDay: number | null;
}

type Checked = { ok: true; invoice: ValidInvoice } | { ok: false; reason: SkipReason };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stepRank(step: unknown): number {
  return STEPS.findIndex((s) => s.step === step); // -1 for anything unknown
}

/** Plain text order, character by character (so "INV-100" < "INV-99"). */
function byInvoiceId(a: { invoice_id: string }, b: { invoice_id: string }): number {
  return a.invoice_id < b.invoice_id ? -1 : a.invoice_id > b.invoice_id ? 1 : 0;
}

/** Data checks other than duplicate_id, in the order the rules give them. */
function checkInvoice(raw: JsonObject, today: number): Checked {
  const amount = raw.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }

  const due = raw.due_date;
  if (due === undefined || due === null || due === "") {
    return { ok: false, reason: "missing_due_date" };
  }
  const dueDay = parseDate(due);
  if (dueDay === null) return { ok: false, reason: "invalid_due_date" };

  let paidDay: number | null = null;
  const paid = raw.paid_date;
  if (paid !== undefined && paid !== null) {
    paidDay = parseDate(paid);
    if (paidDay === null || paidDay > today) return { ok: false, reason: "invalid_paid_date" };
  }

  return {
    ok: true,
    invoice: {
      id: raw.id as string,
      customer: String(raw.customer),
      amount,
      currency: String(raw.currency),
      dueDate: due as string,
      dueDay,
      paidDay,
    },
  };
}

/** Highest valid step already sent for each invoice id, as an index into STEPS. */
function highestSentByInvoice(sent: unknown[]): Map<string, number> {
  const highest = new Map<string, number>();
  for (const entry of sent) {
    if (!isObject(entry) || typeof entry.invoice_id !== "string") continue;
    const rank = stepRank(entry.step);
    if (rank < 0) continue;
    highest.set(entry.invoice_id, Math.max(rank, highest.get(entry.invoice_id) ?? -1));
  }
  return highest;
}

/** The step to plan for one valid, unpaid invoice, or null when nothing is due. */
function planStep(daysOverdue: number, highestSent: number): (typeof STEPS)[number] | null {
  let reached = -1;
  STEPS.forEach((s, i) => {
    if (daysOverdue >= s.minDays) reached = i;
  });
  if (reached < 0) return null; // not yet
  if (highestSent >= reached) return null; // this step or a higher one was already sent
  return STEPS[reached];
}

/**
 * Return the plan for `today`.
 * invoices: the list from invoices.json
 * sent: the list from sent.json
 * today: a date string, YYYY-MM-DD
 * Throws if `today` is not a real YYYY-MM-DD date.
 */
export function buildPlan(invoices: unknown[], sent: unknown[], today: string): Plan {
  const todayDay = parseDate(today);
  if (todayDay === null) throw new Error(`today must be a real date as YYYY-MM-DD, got ${JSON.stringify(today)}`);

  // Entries without a text id cannot be reported against an id, so they are left out.
  const records = invoices.filter((r): r is JsonObject => isObject(r) && typeof r.id === "string");

  const idCounts = new Map<string, number>();
  for (const r of records) idCounts.set(r.id as string, (idCounts.get(r.id as string) ?? 0) + 1);

  const highestSent = highestSentByInvoice(sent);
  const actions: Action[] = [];
  const skipped: Skipped[] = [];
  const reportedDuplicates = new Set<string>();

  for (const raw of records) {
    const id = raw.id as string;

    if ((idCounts.get(id) ?? 0) > 1) {
      if (!reportedDuplicates.has(id)) {
        reportedDuplicates.add(id);
        skipped.push({ invoice_id: id, reason: "duplicate_id" });
      }
      continue;
    }

    const checked = checkInvoice(raw, todayDay);
    if (!checked.ok) {
      skipped.push({ invoice_id: id, reason: checked.reason });
      continue;
    }

    const invoice = checked.invoice;
    if (invoice.paidDay !== null) continue; // paid: nothing to do

    const daysOverdue = todayDay - invoice.dueDay;
    const step = planStep(daysOverdue, highestSent.get(id) ?? -1);
    if (!step) continue;

    actions.push({
      invoice_id: id,
      step: step.step,
      needs_approval: step.needsApproval,
      days_overdue: daysOverdue,
      message: buildMessage({
        step: step.step,
        customer: invoice.customer,
        invoiceId: id,
        amount: invoice.amount,
        currency: invoice.currency,
        dueDate: invoice.dueDate,
        daysOverdue,
      }),
    });
  }

  actions.sort(byInvoiceId);
  skipped.sort(byInvoiceId);
  return { today, actions, skipped };
}
