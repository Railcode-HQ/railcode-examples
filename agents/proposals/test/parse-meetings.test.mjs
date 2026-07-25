// Parser check against a real Granola payload. Regenerate the fixture with:
//   railcode personal-connectors call granola list_meetings \
//     --args '{"time_range":"last_30_days"}' --json > test/fixtures/list-meetings.json
// Then:  npm run test:parse
//
// Guards the case that actually broke: meeting titles contain RAW angle
// brackets ("Yakko <> Gurleen"), so the payload is not well-formed XML and any
// parser that treats ">" as the end of the open tag silently drops the title
// and date while still finding the right number of meetings.
import { parseMeetingsXml, isExternal, domainOf } from "../dist-test/granola.js";
import { readFileSync } from "node:fs";

const env = JSON.parse(readFileSync(process.argv[2], "utf8"));
const text = env.result.find(r => typeof r.text === "string").text;

const claimed = /count="(\d+)"/.exec(text)?.[1];
const meetings = parseMeetingsXml(text);
const own = domainOf(process.env.OWN_EMAIL || "dana@northwind.example");

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log("  FAIL:", msg); fail++; } };

console.log(`claimed count=${claimed}  parsed=${meetings.length}`);
check(String(meetings.length) === claimed, "parsed count != count attribute");

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
for (const m of meetings) {
  check(uuid.test(m.id), `bad uuid: ${m.id}`);
  check(!!m.title, `empty title for ${m.id}`);
  check(!!m.date, `unparseable date "${m.dateLabel}" for ${m.title}`);
}
check(new Set(meetings.map(m => m.id)).size === meetings.length, "duplicate ids");

const ext = meetings.filter(m => isExternal(m, own));
// The internal-only meeting must NOT be treated as a client call: that
// classification is what decides whether the cron drafts a proposal unattended.
const internal = meetings.filter(m => !isExternal(m, own)).map(m => m.title);
check(internal.length > 0, "expected at least one internal meeting in the fixture");
// Both fixture meetings whose every participant is on the own-domain — note
// one of them is a "Dana <> Sam" 1:1, i.e. the <> convention alone must not
// imply an outside party.
const expectedInternal = ["Dana <> Sam", "Weekly engineering sync"];
check(
  JSON.stringify(internal.slice().sort()) === JSON.stringify(expectedInternal.slice().sort()),
  `unexpected internal set: ${JSON.stringify(internal)}`,
);

// Titles with raw angle brackets are the regression this file exists for.
const angle = meetings.filter(m => m.title.includes("<>"));
check(angle.length > 0, "fixture lost its raw-angle-bracket titles");
check(angle.every(m => m.date && m.title), "raw angle brackets broke title/date extraction");
check(meetings.some(m => m.title.includes("&")), "entity-decoded title missing from fixture");
console.log(`dates parsed to ISO: ${meetings.filter(m=>m.date).length}/${meetings.length}`);
console.log(`external (client) meetings: ${ext.length}/${meetings.length}`);
console.log(`sample: ${meetings[0].date} | domains=${JSON.stringify(meetings[0].domains)} | external=${isExternal(meetings[0], own)}`);
console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
