// Payment reminder rules engine (part 1), command line.
//
// Run from inside typescript/ (after npm install):
//
//   npm run plan -- --invoices ../data/invoices.json --sent ../data/sent.json --today 2026-10-12 --out ../actions.json
//
// The rules themselves live in rules.ts; this file only handles arguments and files.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isValidDate } from "./dates";
import { buildPlan } from "./rules";

export { buildPlan } from "./rules";
export type { Plan, Action, Skipped } from "./rules";

const USAGE = "Usage: npm run plan -- --invoices FILE --sent FILE --today YYYY-MM-DD --out FILE";

/** A problem the user can fix; shown as a plain message without a stack trace. */
export class InputError extends Error {}

/** Read a JSON file that must hold a list. `label` names the file in error messages. */
export function readJsonList(path: string, label: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    throw new InputError(`Cannot read ${label} file "${path}": ${(err as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new InputError(`${label} file "${path}" is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(data)) throw new InputError(`${label} file "${path}" must contain a JSON list`);
  return data;
}

/** Run the command with the given arguments; returns the process exit code. */
export function run(argv: string[]): number {
  try {
    let values;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          invoices: { type: "string" },
          sent: { type: "string" },
          today: { type: "string" },
          out: { type: "string" },
        },
      }));
    } catch (err) {
      throw new InputError(`${(err as Error).message}\n${USAGE}`);
    }
    if (!values.invoices || !values.sent || !values.today || !values.out) {
      throw new InputError(USAGE);
    }
    if (!isValidDate(values.today)) {
      throw new InputError(`--today must be a real date as YYYY-MM-DD, got "${values.today}"`);
    }

    const invoices = readJsonList(values.invoices, "invoices");
    const sent = readJsonList(values.sent, "sent");
    const plan = buildPlan(invoices, sent, values.today);

    try {
      writeFileSync(values.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
    } catch (err) {
      throw new InputError(`Cannot write output file "${values.out}": ${(err as Error).message}`);
    }
    return 0;
  } catch (err) {
    console.error(err instanceof InputError ? `Error: ${err.message}` : err);
    return err instanceof InputError ? 2 : 1;
  }
}

// Run only when this file is started directly, not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv.slice(2));
}
