// The owner's page (part 2). Uses only node:http, no framework needed.
//
// Run from inside typescript/:  npm run app
//
// Environment variables:
//   PORT      port to listen on, default 8000
//   DATA_DIR  folder with invoices.json and sent.json, default ../data
//   TODAY     date as YYYY-MM-DD, default the real date
//
// The data files are read again on every request, so the page always shows the
// current files. Decisions are kept in memory while the app runs.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isValidDate } from "./dates";
import { anchorFor, renderErrorPage, renderPlanPage, type Decision, type PageData } from "./page";
import { InputError, readJsonList } from "./plan";
import { buildPlan } from "./rules";

const MAX_BODY_BYTES = 10_000;

export interface AppOptions {
  dataDir: string;
  today: string;
}

/** Decisions per reminder, keyed by invoice id and step, so a decision on "firm" does not carry to "final". */
export type Decisions = Map<string, Decision>;

function decisionKey(invoiceId: string, step: string): string {
  return JSON.stringify([invoiceId, step]);
}

function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** A problem shown to the owner as a page, with the HTTP status to send. */
class PageError extends Error {
  constructor(public status: number, public title: string, detail: string) {
    super(detail);
  }
}

/** Read the data, run the rules engine and join each row with the invoice details the page shows. */
export function loadPage(options: AppOptions, decisions: Decisions): PageData {
  if (!isValidDate(options.today)) {
    throw new PageError(
      500,
      "The date setting is not valid",
      `TODAY is set to "${options.today}". It must be a real date written as YYYY-MM-DD, for example 2026-10-12.`,
    );
  }
  let invoices: unknown[];
  let sent: unknown[];
  try {
    invoices = readJsonList(join(options.dataDir, "invoices.json"), "invoices");
    sent = readJsonList(join(options.dataDir, "sent.json"), "sent");
  } catch (err) {
    if (err instanceof InputError) throw new PageError(500, "The invoice data cannot be read", err.message);
    throw err;
  }

  const plan = buildPlan(invoices, sent, options.today);

  // Customer details by id, from the first invoice with that id.
  const byId = new Map<string, Record<string, unknown>>();
  for (const inv of invoices) {
    if (typeof inv === "object" && inv !== null && typeof (inv as { id?: unknown }).id === "string") {
      const record = inv as Record<string, unknown>;
      if (!byId.has(record.id as string)) byId.set(record.id as string, record);
    }
  }

  return {
    today: plan.today,
    actions: plan.actions.map((a) => {
      const inv = byId.get(a.invoice_id)!; // actions only come from valid invoices with a unique id
      return {
        ...a,
        customer: String(inv.customer),
        amount: inv.amount as number,
        currency: String(inv.currency),
        decision: a.needs_approval ? decisions.get(decisionKey(a.invoice_id, a.step)) ?? null : null,
      };
    }),
    skipped: plan.skipped.map((s) => {
      const customer = byId.get(s.invoice_id)?.customer;
      return { ...s, customer: typeof customer === "string" && customer !== "" ? customer : null };
    }),
  };
}

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new PageError(413, "The request is too large", "The form sent more data than expected."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleDecision(req: IncomingMessage, res: ServerResponse, options: AppOptions, decisions: Decisions) {
  const form = new URLSearchParams(await readBody(req));
  const invoiceId = form.get("invoice_id") ?? "";
  const step = form.get("step") ?? "";
  const decision = form.get("decision");

  const page = loadPage(options, decisions);
  const action = page.actions.find((a) => a.invoice_id === invoiceId && a.step === step);
  if (decision !== "approved" && decision !== "rejected") {
    throw new PageError(400, "That decision was not understood", "Use the Approve or Reject button on the reminder.");
  }
  if (!action || !action.needs_approval) {
    throw new PageError(
      409,
      "That reminder is not waiting for a decision",
      `There is no firm reminder or final notice for invoice "${invoiceId}" in today's plan. The data may have changed; reload the page.`,
    );
  }
  decisions.set(decisionKey(invoiceId, step), decision);
  res.writeHead(303, { Location: `/#${anchorFor(invoiceId)}` });
  res.end();
}

export function createApp(options: AppOptions, decisions: Decisions = new Map()): Server {
  return createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    try {
      if (path === "/" && (req.method === "GET" || req.method === "HEAD")) {
        send(res, 200, renderPlanPage(loadPage(options, decisions)));
      } else if (path === "/decide" && req.method === "POST") {
        await handleDecision(req, res, options, decisions);
      } else if (path === "/" || path === "/decide") {
        res.writeHead(405, { Allow: path === "/" ? "GET, HEAD" : "POST" }).end();
      } else {
        send(res, 404, renderErrorPage("Page not found", "This address does not exist. Go to the start page at /."));
      }
    } catch (err) {
      if (err instanceof PageError) {
        send(res, err.status, renderErrorPage(err.title, err.message));
      } else {
        console.error(err);
        send(res, 500, renderErrorPage("Something went wrong", "The page could not be built. Details are in the server log."));
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || "8000");
  const options: AppOptions = {
    dataDir: process.env.DATA_DIR || "../data",
    today: process.env.TODAY || localToday(),
  };
  createApp(options).listen(port, () => {
    console.log(`Serving on http://localhost:${port}/ (data: ${options.dataDir}, today: ${options.today})`);
  });
}
