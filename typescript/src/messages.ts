// Reminder email text (part 3).
//
// Placeholder template for now; it already contains every required fact and no
// other figure.

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

export function formatAmount(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export function buildMessage(facts: MessageFacts): string {
  const amount = formatAmount(facts.amount, facts.currency);
  return (
    `Dear ${facts.customer}, invoice ${facts.invoiceId} for ${amount} was due on ${facts.dueDate} ` +
    `and is now ${facts.daysOverdue} days overdue. Please arrange payment.`
  );
}
