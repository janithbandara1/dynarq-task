// Reminder email text (part 3).
//
// One template per step. A message holds only facts from the invoice: customer,
// invoice id, amount, due date and days overdue. No fees, interest, deadlines or
// mentions of earlier reminders; legal wording is the owner's decision.
// checkMessage states those rules as code, and the tests run every template through it.

import type { Step } from "./rules";

export interface MessageFacts {
  step: Step;
  customer: string;
  invoiceId: string;
  amount: number;
  currency: string;
  dueDate: string;
  daysOverdue: number;
}

/** Currency and amount with 2 decimals, for example "EUR 1250.00". */
export function formatAmount(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

function daysText(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

const TEMPLATES: Record<Step, (f: MessageFacts, amount: string, days: string) => string[]> = {
  friendly: (f, amount, days) => [
    `Dear ${f.customer},`,
    `This is a friendly reminder that invoice ${f.invoiceId} for ${amount}, due on ${f.dueDate}, is now ${days} overdue. ` +
      "It may simply have been overlooked.",
    "If you have already paid, thank you, and please ignore this message. " +
      "Otherwise, we would be grateful if you could arrange payment at your earliest convenience.",
    "Kind regards",
  ],
  firm: (f, amount, days) => [
    `Dear ${f.customer},`,
    `Invoice ${f.invoiceId} for ${amount} was due on ${f.dueDate} and is now ${days} overdue. ` +
      "Please arrange payment of the full amount promptly.",
    "If there is a problem with this invoice, please reply to this email so we can resolve it.",
    "Kind regards",
  ],
  final: (f, amount, days) => [
    `Dear ${f.customer},`,
    `This is a final notice about invoice ${f.invoiceId} for ${amount}, which was due on ${f.dueDate} ` +
      `and is now ${days} overdue.`,
    "Please pay the full amount immediately. If you have already paid, or believe this notice is in error, " +
      "please reply to us right away.",
    "Kind regards",
  ],
};

export function buildMessage(facts: MessageFacts): string {
  const paragraphs = TEMPLATES[facts.step](facts, formatAmount(facts.amount, facts.currency), daysText(facts.daysOverdue));
  return paragraphs.join("\n\n");
}

/** Words that would add a claim the invoice data does not support. Matched as whole words. */
const FORBIDDEN = [
  /\bfees?\b/i,
  /\binterest\b/i,
  /\bcharge[sd]?\b/i,
  /\bpenalt(y|ies)\b/i,
  /\bcompensation\b/i,
  /\blegal\b/i,
  /\bcourts?\b/i,
  /\blawyers?\b/i,
  /\bsolicitors?\b/i,
  /\bdebt collect/i,
  /\bdeadline\b/i,
  /\bwithin\b/i,
  /\bby the end of\b/i,
  /\bECB\b/i,
  /\bprevious(ly)?\b/i,
  /\bearlier\b/i,
  /\bagain\b/i,
  /\blast (reminder|notice|email|message)\b/i,
  /\balready (sent|reminded|contacted|written)\b/i,
  /\b(second|third) (reminder|notice)\b/i,
  /%/,
];

/** Remove every occurrence of each literal string (no regex, so names like "A+B (UK)" are safe). */
function removeAll(text: string, parts: string[]): string {
  return parts
    .filter((p) => p !== "")
    .sort((a, b) => b.length - a.length)
    .reduce((t, p) => t.split(p).join(" "), text);
}

/**
 * Check a message against the part 3 rules; returns the problems found, empty when it is fine.
 * Use it on any text before it goes out, whether it came from a template or anywhere else.
 */
export function checkMessage(message: string, facts: MessageFacts): string[] {
  const problems: string[] = [];
  const amount = formatAmount(facts.amount, facts.currency);
  const days = `${daysText(facts.daysOverdue)} overdue`;

  const required: Array<[string, string]> = [
    ["customer name", facts.customer],
    ["invoice id", facts.invoiceId],
    ["due date", facts.dueDate],
    ["amount", amount],
    ["days overdue", days],
  ];
  for (const [label, value] of required) {
    if (!message.includes(value)) problems.push(`missing ${label} "${value}"`);
  }

  // What is left once the invoice's own facts are taken out must hold no figure and no forbidden word.
  const rest = removeAll(message, [facts.customer, facts.invoiceId, facts.dueDate, amount, days]);
  const figure = /\d/.exec(rest);
  if (figure) problems.push(`contains a figure that is not an invoice fact near "${rest.slice(Math.max(0, figure.index - 15), figure.index + 15).trim()}"`);
  for (const pattern of FORBIDDEN) {
    const match = pattern.exec(rest);
    if (match) problems.push(`contains "${match[0]}", which is not in the invoice data`);
  }
  return problems;
}
