# Local fictional demo evidence

Every file in this directory is fictional. The names describe invented staff and organizations. There are no real patient, child, customer or meal-recipient identities. The CSVs and operational notes are source records for actual local agent work; they are not finished reports.

`projects/<id>/` contains the archived baseline. Each project retains the eight filenames attached by the original story: weekly metrics, owner register, project brief, decisions, budget, release notes, review agenda and evidence index. The additional files provide the underlying records needed to reconcile counts and reason about the requested work. All exports use the week ending 2026-09-06. The runtime may put copies under a workspace's `data/projects/` directory.

Support registers count imported records as the baseline did. Pinecone starts with 18 current records and Beacon with 39 connected meters. A correction applies only after its source arrival is delivered. The baseline does not include PIN's later duplicate determination, Beacon's later connection verification, confirmed dinner details, completed patches or successful current QA.

`checkout/` is the intentionally broken PIN-184 fixture. Its README explains the expected failing tests. Workers edit their own copies and QA uses the completed patch workspace.

`arrivals/gmail/` and `arrivals/slack/` each contain an 11-message conversation in `sequence.json`. Entries name real attachment files beside the JSON. These are future arrivals; only expose their attachments when delivered. Gmail supports the existing HBR pilot readout. Slack supports the existing PIN-184 patch and dependent PIN-185 QA. The original test log records a real run of the broken local fixture and claims no successful fix.

## Project source map

| Project | Operational records | Decisions the records support |
| --- | --- | --- |
| Pinecone | `pin-merchant-register.csv`, `pin-migration-checks.csv`, `pin-support-register.csv` | Count 170 activated of 250; name all seven unconfirmed migration owners; preserve rollout hold. |
| Harbor | `hbr-clinic-delivery.csv`, `hbr-copy-review.md`, `hbr-support-register.csv` | Sum 84 of 120; name Pier Family Practice and Tide Street Clinic approvals; keep patient information out. |
| Juniper | `lib-branch-utilization.csv`, `lib-service-log.md` | Sum 63 of 90; compare room hours; distinguish phone service from kiosk outage. |
| Beacon | `bg-meter-register.csv`, `bg-feed-log.md` | Count 39 of 60; identify Canal House and Station Annex delayed feeds; retain dates instead of estimating missing usage. |
| Maple | `map-club-capacity.csv`, `map-waitlist.csv`, `map-enrollment-policy.md` | Sum 112 of 160; assess robotics and ceramics capacity and dated waitlists without promising places. |
| Northstar | `ns-asset-register.csv`, `ns-print-handoff.md` | Count 46 approved of 80; distinguish digital approval from 24 pending print proofs; respect withdrawal. |
| Orchard | `orc-packing-batches.csv`, `orc-produce-stock.csv`, `orc-grower-weather-note.md` | Sum 156 of 200; assess packing remainder and possible tomato shortage; preserve customer approval rule. |
| Metro | `met-station-register.csv`, `met-depot-stock.csv`, `met-route-constraints.md` | Count 52 healthy of 75; rank commuter outages; distinguish two available batteries from an expected six-unit shipment. |
| Lumen | `lum-tour-slots.csv`, `lum-volunteer-roster.csv`, `lum-access-policy.md` | Sum 91 bookings of 140 released slots; identify missing trained Sculpture Hall volunteer; retain protected slots. |
| Cedar | `cdr-collection-sites.csv`, `cdr-preparation-batches.csv`, `cdr-kitchen-resources.csv`, `cdr-inspection-and-handling.md` | Sum 128 of 180; calculate an oven contingency before packing and pickup; omit private allergy details. |

Each project also has an actual `<code>-operations-notes.md` with sections 1 through 7 backing the owner-register references. Support counts and budgets stay project-specific.

## Built-in arrival coverage

IDs below omit the `arrival-` prefix. A follow-up updates or revises existing work; it is not a second independent task. A waiting arrival is functional when it keeps the prerequisite explicit and produces no premature result.

| Arrival | Expected result | Evidence and prerequisite |
| --- | --- | --- |
| launch-request | Produce PIN launch report | Pinecone baseline, including owners and migration checks. |
| launch-cross-reference | Update same report | `pin-owner-register.csv`; existing PIN work or pending report. |
| launch-thanks | Ignore | Explicit thank-you, no new request. |
| qa-before-fix | Wait, then produce QA | Completed PIN-184 patch workspace, fresh checkout test output. |
| checkout-regression | Produce patch and test evidence | Broken `checkout/` and delivered reproduction JSON. |
| checkout-community | Attach evidence to same patch work | Same PIN-184 identity and receipt values. |
| checkout-provider-redelivery | Ignore duplicate delivery | Same provider external identity as checkout regression. |
| meeting-prep | Wait, then produce brief | Completed PIN report and verified PIN-185 QA; existing calendar event. |
| dinner-vague | Wait | Date and time not yet confirmed. |
| support-correction | Revise existing PIN report | Delivered `pin-support-corrected.csv`; does not change baseline archive. |
| dinner-conflict | Wait and explain overlap | Existing ceramics block and requested time; no event creation. |
| dinner-confirmed | Produce one local calendar event | Delivered `pinecone-dinner.json`, existing calendar and final confirmation. |
| meeting-context | Update same meeting preparation | Corrected PIN report and verified QA; wait if either missing. |
| harbor-report | Produce separate HBR report | Harbor baseline; no PIN counts. |
| old-issue-closed | Ignore | Closed PIN-172; distinct from PIN-184. |
| newsletter | Ignore | General publication, no request. |
| qa-owner-context | Update same QA scope | Completed PIN-184 workspace is still required. |
| library-report | Produce LIB report | Juniper branch utilization, owners and service log. |
| beacon-review | Produce BG brief | Beacon meter rows, budget and feed log; existing meeting. |
| maple-update | Produce MAP report | Club capacity, anonymous dated waitlist and enrollment policy. |
| northstar-withdrawn | Ignore | Withdrawn request; print handoff record. |
| orchard-report | Produce ORC report | Packing rows, grower owners, stock and weather note. |
| metro-question | Produce MET planning brief | Station outages, depot stock and route constraints; no dispatch. |
| lumen-meeting | Produce LUM brief | Tour slots, roster and access policy; existing meeting. |
| cedar-report | Produce CDR report | Site totals, batch durations, kitchen constraints; no private allergy details. |
| library-followup | Update same LIB report | West Branch service log; branch is open with phone booking. |
| personal-date-vague | Wait | Family museum, weekend and time missing; keep separate from dinner. |
| harbor-acknowledgment | Ignore | Receipt confirmation, no new request. |
| beacon-correction | Revise same BG brief | Delivered `bg-meter-correction.md`; baseline BG-M40 is unconnected. |
| calendar-no-change | Ignore | RSVP only; event unchanged. |
| community-social | Ignore | Social comment with no task. |

The original story has no confirming reply for Dad's museum request. That arrival must wait until a later user-supplied or added confirmation gives the museum, date and time. Project data cannot supply personal consent or resolve that omission. BG and LUM preparation requests refer to already-booked meetings; runtime calendar records must include them.

## Extended conversation coverage

Gmail messages 01 through 09 and 11 belong to the same HBR report. They supply scope, clinic counts, owner responsibilities, paid invoices, question rows, copy policy, pending coordinator approvals, the prior issue's decision record and a final review checklist. Message 08 supplies context and must not create a software task. Message 10 is an acknowledgment to ignore. Earlier requests can use the project baseline without waiting for future emails; later evidence can revise the same report. The five invoice rows total $21,900 and reconcile with the existing budget lines.

Slack messages 01 through 06 and 09 belong to the same PIN-184 fix. The attachments include original code, reproduction cases, receipt rows, original failing output, acceptance tests and the arithmetic contract. Messages 07, 08 and 10 belong to PIN-185 and must wait for the completed patch. Message 11 is an acknowledgment to ignore. None of these messages asserts that an agent already completed the patch or QA.
