# Payment reminder assistant (TypeScript)

## Run it (Node.js 20+, from inside `typescript/`, after `npm install`)
- Tests: `npm test` (rules, dates, command line, messages, page). Types: `npm run typecheck`.
- Command: `npm run plan -- --invoices ../data/invoices.json --sent ../data/sent.json --today 2026-10-12 --out ../actions.json`
- Page: `npm run app`, then open http://localhost:8000/. Settings: `PORT` (8000), `DATA_DIR` (`../data`), `TODAY` (real date).

## Decisions
- `src/rules.ts` holds the rules as a pure `buildPlan` (no files, no clock). The command (`src/plan.ts`) and the page (`src/app.ts`) both call it.
- The steps live in one `STEPS` table (3, 10, 24 days), so a threshold is changed in one place.
- `src/dates.ts` accepts only real `YYYY-MM-DD` dates and counts whole days in UTC, so time zones cannot shift a day count.
- A bad `--today`, a missing file, broken JSON or a file that is not a list prints a clear message and exits with code 2.
- The page is HTML built on the server, with no framework and no browser JavaScript. Approve and Reject are form buttons, so the keyboard works by default. It reads the data again on every request.
- Decisions are kept in memory per invoice and step, so approving `firm` does not approve a later `final`.
- Messages come from one template per step (`src/messages.ts`), not an AI model, so they need no key or internet. `checkMessage` requires every invoice fact and rejects any other figure, fees, interest, deadlines or mentions of earlier reminders. The tests run every template through it.
- `RESEARCH.md` answers only from `sources/`. The owner's 25 EUR late fee and ECB rate are left out of the messages on purpose.

## With more time
- Build the page with a frontend framework (components, client-side updates without a full page reload), keeping `buildPlan` behind a small JSON API.
- Save decisions to a file or database, and keep a history of who decided what and when.
- Add a login and protection against forged form posts before the page runs anywhere but the owner's machine.
- Actually send the emails once approved, and add `sent.json` entries automatically.
- Optional AI-written messages behind an API key, accepted only when `checkMessage` finds no problem.
- Browser tests at 390 px and with the keyboard; a clear message when the port is in use.
