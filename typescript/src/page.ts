// HTML for the owner's page (part 2). Pure functions: data in, HTML string out.

import { formatAmount } from "./messages";
import type { Action, SkipReason, Skipped, Step } from "./rules";

export type Decision = "approved" | "rejected";

/** An action with the invoice details the page shows next to it. */
export interface ActionRow extends Action {
  customer: string;
  amount: number;
  currency: string;
  decision: Decision | null;
}

export interface SkippedRow extends Skipped {
  customer: string | null;
}

export interface PageData {
  today: string;
  actions: ActionRow[];
  skipped: SkippedRow[];
}

export const REASON_TEXT: Record<SkipReason, string> = {
  duplicate_id: "More than one invoice uses this invoice number, so none of them was checked. Give each invoice its own number.",
  invalid_amount: "The amount is missing, is not a number, or is zero or less.",
  missing_due_date: "The invoice has no due date.",
  invalid_due_date: "The due date is not a real date. It must be written as YYYY-MM-DD, for example 2026-09-30.",
  invalid_paid_date: "The paid date is not a real date in the form YYYY-MM-DD, or it is later than today.",
};

const STEP_LABEL: Record<Step, string> = {
  friendly: "Friendly reminder",
  firm: "Firm reminder",
  final: "Final notice",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** id attribute for an action card, also used as the anchor after a decision. */
export function anchorFor(invoiceId: string): string {
  return `invoice-${encodeURIComponent(invoiceId)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const STYLE = `
:root { --fg:#1b1f24; --muted:#57606a; --bg:#f6f7f9; --card:#fff; --line:#d0d7de;
  --accent:#0b5cad; --ok:#1a7f37; --ok-bg:#dafbe1; --bad:#b42318; --bad-bg:#ffebe9;
  --wait:#7d4e00; --wait-bg:#fff8c5; --focus:#0b5cad; }
* { box-sizing: border-box; }
body { margin:0; font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--fg); background:var(--bg); }
main { max-width:52rem; margin:0 auto; padding:16px; }
h1 { font-size:1.6rem; margin:0 0 4px; }
h2 { font-size:1.25rem; margin:32px 0 8px; }
h3 { font-size:1.05rem; margin:0; }
p { margin:0 0 8px; }
.muted { color:var(--muted); }
.summary { display:flex; flex-wrap:wrap; gap:8px; padding:0; margin:12px 0 0; list-style:none; }
.summary li { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:6px 10px; }
.cards { list-style:none; padding:0; margin:0; display:grid; gap:12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; }
.card:target { outline:3px solid var(--focus); outline-offset:2px; }
.card-head { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 12px; align-items:baseline; }
dl { display:grid; grid-template-columns:max-content 1fr; gap:2px 12px; margin:10px 0; }
dt { color:var(--muted); }
dd { margin:0; overflow-wrap:anywhere; }
.message { white-space:pre-wrap; overflow-wrap:anywhere; background:var(--bg); border-left:4px solid var(--line); padding:8px 10px; margin:6px 0 0; font:inherit; }
details summary { cursor:pointer; color:var(--accent); padding:4px 0; }
.badge { display:inline-block; border-radius:999px; padding:1px 10px; font-size:.9rem; font-weight:600; }
.badge.auto { background:#ddf4ff; color:#0a3069; }
.badge.wait { background:var(--wait-bg); color:var(--wait); }
.badge.approved { background:var(--ok-bg); color:var(--ok); }
.badge.rejected { background:var(--bad-bg); color:var(--bad); }
form.decide { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
button { font:inherit; font-weight:600; min-height:44px; padding:8px 18px; border-radius:8px; border:2px solid transparent; cursor:pointer; }
button.approve { background:var(--ok); color:#fff; }
button.reject { background:var(--card); color:var(--bad); border-color:var(--bad); }
button:hover { filter:brightness(.92); }
:focus-visible { outline:3px solid var(--focus); outline-offset:2px; }
.notice { background:var(--card); border:1px solid var(--line); border-left:6px solid var(--accent); border-radius:8px; padding:12px 14px; }
.notice.error { border-left-color:var(--bad); }
.skip-link { position:absolute; left:-999px; }
.skip-link:focus { left:16px; top:8px; background:var(--card); padding:8px; z-index:1; }
`;

function layout(title: string, body: string): string {
  return (
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>` +
    `<body><a class="skip-link" href="#main">Skip to content</a><main id="main">${body}</main></body></html>`
  );
}

function statusBadge(row: ActionRow): string {
  if (!row.needs_approval) return '<span class="badge auto">No approval needed</span>';
  if (row.decision === "approved") return '<span class="badge approved">Approved</span>';
  if (row.decision === "rejected") return '<span class="badge rejected">Rejected</span>';
  return '<span class="badge wait">Waiting for your decision</span>';
}

function decisionForm(row: ActionRow): string {
  if (!row.needs_approval) return "";
  const hidden =
    `<input type="hidden" name="invoice_id" value="${escapeHtml(row.invoice_id)}">` +
    `<input type="hidden" name="step" value="${row.step}">`;
  const label = `${STEP_LABEL[row.step].toLowerCase()} for ${row.invoice_id}`;
  const approve = `<button class="approve" name="decision" value="approved" aria-label="${escapeHtml(`Approve ${label}`)}">Approve</button>`;
  const reject = `<button class="reject" name="decision" value="rejected" aria-label="${escapeHtml(`Reject ${label}`)}">Reject</button>`;
  let buttons = approve + reject;
  if (row.decision === "approved") buttons = reject.replace(">Reject<", ">Change to reject<");
  if (row.decision === "rejected") buttons = approve.replace(">Approve<", ">Change to approve<");
  return `<form class="decide" method="post" action="/decide">${hidden}${buttons}</form>`;
}

function actionCard(row: ActionRow): string {
  return (
    `<li class="card" id="${escapeHtml(anchorFor(row.invoice_id))}">` +
    `<div class="card-head"><h3>${escapeHtml(row.customer)}</h3>${statusBadge(row)}</div>` +
    "<dl>" +
    `<dt>Invoice</dt><dd>${escapeHtml(row.invoice_id)}</dd>` +
    `<dt>Amount</dt><dd>${escapeHtml(formatAmount(row.amount, row.currency))}</dd>` +
    `<dt>Overdue</dt><dd>${plural(row.days_overdue, "day", "days")}</dd>` +
    `<dt>Step</dt><dd>${STEP_LABEL[row.step]}</dd>` +
    "</dl>" +
    `<details open><summary>Email to the customer</summary><p class="message">${escapeHtml(row.message)}</p></details>` +
    decisionForm(row) +
    "</li>"
  );
}

function skippedCard(row: SkippedRow): string {
  const who = row.customer ? ` <span class="muted">(${escapeHtml(row.customer)})</span>` : "";
  return (
    `<li class="card"><h3>${escapeHtml(row.invoice_id)}${who}</h3>` +
    `<p>${escapeHtml(REASON_TEXT[row.reason])}</p></li>`
  );
}

export function renderPlanPage(data: PageData): string {
  const waiting = data.actions.filter((a) => a.needs_approval && a.decision === null).length;
  const automatic = data.actions.filter((a) => !a.needs_approval).length;

  let body =
    `<h1>Payment reminders</h1><p class="muted">Plan for ${escapeHtml(data.today)}</p>` +
    '<ul class="summary" aria-label="Summary">' +
    `<li>${plural(data.actions.length, "reminder", "reminders")} today</li>` +
    `<li>${waiting} waiting for your decision</li>` +
    `<li>${plural(automatic, "needs", "need")} no approval</li>` +
    `<li>${plural(data.skipped.length, "invoice", "invoices")} could not be checked</li>` +
    "</ul>";

  body += '<section aria-labelledby="today-h"><h2 id="today-h">Reminders for today</h2>';
  if (data.actions.length === 0) {
    body +=
      '<p class="notice">Nothing to do today. No unpaid invoice has reached a new reminder step, ' +
      "so no reminder needs to go out.</p>";
  } else {
    body +=
      '<p class="muted">Friendly reminders need no approval. Firm reminders and final notices are only sent after you approve them. ' +
      "Nothing is sent from this page; it records your decisions.</p>" +
      `<ul class="cards">${data.actions.map(actionCard).join("")}</ul>`;
  }
  body += "</section>";

  body += '<section aria-labelledby="skipped-h"><h2 id="skipped-h">Invoices that could not be checked</h2>';
  if (data.skipped.length === 0) {
    body += '<p class="notice">All invoices could be checked. There is no problem with the data.</p>';
  } else {
    body +=
      '<p class="muted">These invoices get no reminder until their data is fixed.</p>' +
      `<ul class="cards">${data.skipped.map(skippedCard).join("")}</ul>`;
  }
  body += "</section>";

  return layout(`Payment reminders ${data.today}`, body);
}

export function renderErrorPage(title: string, detail: string): string {
  return layout(
    "Payment reminders: problem",
    `<h1>Payment reminders</h1><div class="notice error" role="alert"><h2>${escapeHtml(title)}</h2>` +
      `<p>${escapeHtml(detail)}</p>` +
      "<p>No reminders are shown until this is fixed, so nothing is missed by mistake. " +
      "Fix the file or setting, then reload this page.</p></div>",
  );
}
