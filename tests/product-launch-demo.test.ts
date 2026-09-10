import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { TOUR_DURATION, tourTime } from '../src/components/demo-tour-model';
import { StateSchema } from '../shared/schemas';
import {
  PRODUCT_LAUNCH_APPROVAL_IDS,
  PRODUCT_LAUNCH_INTERN,
  PRODUCT_LAUNCH_TEAM,
  PRODUCT_LAUNCH_CHAT,
  productLaunchChatAt,
  PRODUCT_LAUNCH_MEETING,
  PRODUCT_LAUNCH_SELECTED_PHOTO_ID,
  PHOTO_OPTIONS,
  productLaunchLandingHTML,
  productLaunchFile,
  productLaunchFilesAt,
  productLaunchOfficeReviewsAt,
  productLaunchStateAt,
} from '../src/lib/product-launch-demo';

test('demo snapshots fit the real AppState schema through the entire two-minute launch', () => {
  for (let elapsed = 0; elapsed <= TOUR_DURATION; elapsed += 100) {
    const state = productLaunchStateAt(elapsed);
    assert.equal(StateSchema.safeParse(state).success, true, `Invalid fixture at ${elapsed}ms`);
    assert.equal(state.demo, true);
    assert.equal(JSON.stringify(state).includes('sessionId'), false);
    const people = new Set(state.employees.map((employee) => employee.id));
    const milestones = new Set(state.commitments.map((commitment) => commitment.id));
    for (const commitment of state.commitments) {
      assert.ok(people.has(commitment.ownerId));
      assert.ok(commitment.dependencies.every((id) => milestones.has(id)));
    }
    for (const approval of state.approvals) {
      assert.ok(people.has(approval.employeeId));
      if (approval.commitmentId) assert.ok(milestones.has(approval.commitmentId));
    }
    for (let index = 1; index < state.messages.length; index++) {
      assert.ok(state.messages[index].time >= state.messages[index - 1].time);
    }
  }
});

test('real employee and goal forms receive the expected roster before and after creation', () => {
  const initial = productLaunchStateAt(tourTime(0));
  assert.deepEqual(
    initial.employees.map((employee) => employee.jobTitle),
    ['Software Engineer', 'Finance Bro', 'Assistant'],
  );
  assert.equal(initial.commitments.length, 0);
  assert.equal(initial.approvals.length, 0);
  assert.equal(initial.folders.length, 0);
  assert.equal(productLaunchStateAt(tourTime(5500) - 1).employees.length, 3);
  assert.equal(productLaunchStateAt(tourTime(5500)).employees.at(-1)?.id, PRODUCT_LAUNCH_INTERN.id);
  assert.equal(productLaunchStateAt(tourTime(11800)).goal, 'Astra HQ Product Launch');
  assert.equal(productLaunchStateAt(tourTime(12000)).roadmap?.status, 'planning');
  assert.equal(productLaunchStateAt(tourTime(13000)).commitments.length, 4);
  assert.ok(
    productLaunchStateAt(tourTime(16000)).employees.every((employee) => employee.status === 'working'),
  );
});

test('longer office passages preserve a stable roster and allow work before the first review', () => {
  for (const elapsed of [0, 3500, 6999]) {
    const state = productLaunchStateAt(elapsed);
    assert.equal(state.employees.length, 3);
    assert.equal(state.commitments.length, 0);
    assert.equal(state.approvals.length, 0);
  }
  for (const elapsed of [16000, 17500, 19499]) {
    const state = productLaunchStateAt(elapsed);
    assert.equal(state.employees.length, 4);
    assert.equal(state.commitments.length, 0);
    assert.equal(state.approvals.length, 0);
  }
  for (const elapsed of [33000, 39000, 45999]) {
    const state = productLaunchStateAt(elapsed);
    assert.ok(state.employees.every((employee) => employee.status === 'working'));
    assert.equal(state.approvals.length, 0);
    assert.ok(productLaunchChatAt(elapsed).length >= 4);
  }
  const celebration = productLaunchStateAt(112500);
  assert.ok(celebration.commitments.every((commitment) => commitment.status === 'done'));
  assert.ok(celebration.approvals.every((approval) => approval.status === 'approved'));
  assert.equal(productLaunchFilesAt(112500).length, 7);
});

test('approvals exist while drafts are being shown and resolve only at scripted approval times', () => {
  const approval = (elapsed: number, id: string) =>
    productLaunchStateAt(elapsed).approvals.find((item) => item.id === id);
  assert.equal(approval(tourTime(20000) - 1, PRODUCT_LAUNCH_APPROVAL_IDS.email), undefined);
  const early = approval(tourTime(20_000), PRODUCT_LAUNCH_APPROVAL_IDS.email)!;
  const completedDraft = approval(tourTime(23_500), PRODUCT_LAUNCH_APPROVAL_IDS.email)!;
  assert.equal(early.status, 'pending');
  assert.ok(completedDraft.content.length > early.content.length);
  assert.match(completedDraft.content, /Looking forward to showing you around/);
  assert.equal(approval(tourTime(26000) - 1, PRODUCT_LAUNCH_APPROVAL_IDS.email)?.status, 'pending');
  assert.equal(approval(tourTime(26_000), PRODUCT_LAUNCH_APPROVAL_IDS.email)?.status, 'approved');
  assert.equal(approval(tourTime(32_000), PRODUCT_LAUNCH_APPROVAL_IDS.pr)?.status, 'pending');
  assert.equal(approval(tourTime(36_000), PRODUCT_LAUNCH_APPROVAL_IDS.pr)?.status, 'approved');
  assert.equal(approval(tourTime(55_000), PRODUCT_LAUNCH_APPROVAL_IDS.campaign)?.status, 'pending');
  assert.equal(approval(tourTime(58_000), PRODUCT_LAUNCH_APPROVAL_IDS.campaign)?.status, 'approved');
});

test('existing Files page can open each preview during its phase, before final completion', () => {
  const file = (elapsed: number, id: string) => productLaunchFilesAt(elapsed).find((item) => item.id === id);
  assert.ok(file(tourTime(37_000), 'profits')?.assetUrl?.endsWith('demo/profit-forecast.xlsx'));
  assert.equal(file(tourTime(37_000), 'profits')?.draft, true);
  assert.equal(file(tourTime(41_000), 'profits')?.draft, false);
  assert.equal(file(tourTime(41_000), 'slogan')?.previewKind, 'html');
  assert.ok(
    file(tourTime(44_000), 'slogan')!.content.length > file(tourTime(41_000), 'slogan')!.content.length,
  );
  assert.ok(file(tourTime(45_000), 'photo')?.assetUrl?.endsWith('demo/marketing-photo-2.png'));
  assert.equal(productLaunchFilesAt(tourTime(60_000)).length, 7);
  assert.ok(
    productLaunchFilesAt(tourTime(60_000)).every((item) => !item.draft && item.path.startsWith('demo://')),
  );
});

test('office exclamation marks connect every review to its employee and available work', () => {
  const expected = [
    {
      id: 'email',
      employeeId: 'assistant',
      from: 20_000,
      until: 26_000,
      approvalId: PRODUCT_LAUNCH_APPROVAL_IDS.email,
    },
    { id: 'meeting', employeeId: 'assistant', from: 27_000, until: 30_500, fileId: 'meeting' },
    {
      id: 'pr',
      employeeId: 'software-engineer',
      from: 32_000,
      until: 36_000,
      approvalId: PRODUCT_LAUNCH_APPROVAL_IDS.pr,
    },
    { id: 'profits', employeeId: 'finance-bro', from: 37_000, until: 40_500, fileId: 'profits' },
    { id: 'slogan', employeeId: PRODUCT_LAUNCH_INTERN.id, from: 41_000, until: 44_500, fileId: 'slogan' },
    { id: 'photo', employeeId: PRODUCT_LAUNCH_INTERN.id, from: 45_000, until: 51_600, fileId: 'photo' },
    { id: 'app', employeeId: 'software-engineer', from: 52_000, until: 54_800, fileId: 'app' },
    {
      id: 'campaign',
      employeeId: PRODUCT_LAUNCH_INTERN.id,
      from: 55_000,
      until: 58_000,
      approvalId: PRODUCT_LAUNCH_APPROVAL_IDS.campaign,
    },
  ];
  for (const item of expected) {
    const start = tourTime(item.from);
    const end = tourTime(item.until);
    assert.deepEqual(productLaunchOfficeReviewsAt(start - 1), [], `No early ${item.id} cue`);
    const [review] = productLaunchOfficeReviewsAt(start);
    assert.equal(review.id, item.id);
    assert.equal(review.employeeId, item.employeeId);
    assert.equal(review.approvalId, item.approvalId);
    assert.equal(review.fileId, item.fileId);
    assert.ok(review.label.length > 0);
    assert.equal(productLaunchOfficeReviewsAt(end - 1)[0]?.id, item.id);
    assert.deepEqual(productLaunchOfficeReviewsAt(end), [], `No stale ${item.id} cue`);
    const state = productLaunchStateAt(start);
    assert.ok(state.employees.some((employee) => employee.id === review.employeeId));
    if (review.fileId) {
      const file = productLaunchFilesAt(start).find((file) => file.id === review.fileId);
      assert.ok(file, `The ${item.id} preview must already be available`);
      assert.equal(file.ownerId, review.employeeId);
    } else {
      const approval = state.approvals.find((approval) => approval.id === review.approvalId);
      assert.ok(approval, `The ${item.id} approval must already be available`);
      assert.equal(approval.employeeId, review.employeeId);
      assert.equal(approval.status, 'pending');
    }
  }
  assert.deepEqual(productLaunchOfficeReviewsAt(tourTime(26_000)), []);
  assert.equal(productLaunchOfficeReviewsAt(tourTime(27_000))[0]?.fileId, 'meeting');
  assert.deepEqual(productLaunchOfficeReviewsAt(tourTime(51_600)), []);
  assert.equal(productLaunchOfficeReviewsAt(tourTime(52_000))[0]?.employeeId, 'software-engineer');
});

test('office review cues clear on reset and completion and cannot be mutated across snapshots', () => {
  for (const elapsed of [
    -1,
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    TOUR_DURATION,
    TOUR_DURATION + 1,
  ]) {
    assert.deepEqual(productLaunchOfficeReviewsAt(elapsed), []);
  }
  const altered = productLaunchOfficeReviewsAt(tourTime(37_000));
  altered[0].employeeId = 'changed';
  altered[0].label = 'changed';
  altered[0].fileId = 'email';
  altered.length = 0;
  const fresh = productLaunchOfficeReviewsAt(tourTime(37_000));
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].employeeId, 'finance-bro');
  assert.equal(fresh[0].fileId, 'profits');
  assert.match(fresh[0].label, /Blake/);
  const finished = productLaunchStateAt(TOUR_DURATION);
  assert.equal(finished.approvals.length, 3);
  assert.ok(finished.approvals.every((approval) => approval.status === 'approved'));
});

test('fixture state is isolated from user edits and downloadable content stays explicitly sample', () => {
  const altered = productLaunchStateAt(tourTime(60_000));
  altered.employees[0].name = 'Changed';
  altered.commitments.length = 0;
  altered.approvals[0].content = 'Changed';
  const fresh = productLaunchStateAt(tourTime(60_000));
  assert.equal(fresh.employees[0].name, 'Alex');
  assert.equal(fresh.commitments.length, 5);
  assert.notEqual(fresh.approvals[0].content, 'Changed');
  assert.ok(fresh.commitments.every((commitment) => commitment.status === 'done'));
  assert.equal(fresh.roadmap?.status, 'complete');
  assert.match(productLaunchFile('meeting').downloadContent!, /STATUS:TENTATIVE/);
  assert.match(productLaunchFile('meeting').downloadContent!, /Not scheduled or sent/);
  assert.match(productLaunchFile('email').downloadContent!, /DEMO DRAFT ONLY/);
  assert.match(productLaunchFile('pr').downloadContent!, /no real repository change/);
  assert.match(productLaunchFile('app').content, /fictional sample/);
});

test('Thrive Capital email stays fictional and becomes a correctly timed sample calendar event', () => {
  const email = productLaunchFile('email');
  assert.match(email.downloadContent!, /team@thrivecapital\.example/);
  assert.match(email.downloadContent!, /Hi Thrive Capital team/);
  assert.ok(!productLaunchFilesAt(tourTime(27000) - 1).some((file) => file.id === 'meeting'));
  assert.ok(productLaunchFilesAt(tourTime(27_000)).some((file) => file.id === 'meeting'));
  const meeting = productLaunchFile('meeting');
  assert.equal(meeting.title, PRODUCT_LAUNCH_MEETING.title);
  assert.match(meeting.downloadContent!, /DTSTART:20261015T140000Z/);
  assert.match(meeting.downloadContent!, /DTEND:20261015T143000Z/);
  assert.match(meeting.downloadContent!, /SUMMARY:\[SAMPLE\] Astra HQ Product Launch × Thrive Capital/);
  assert.equal(new Date('2026-10-15T14:00:00Z').getUTCDay(), 4);
});

test('three photo options lead to the selected image handoff and a prepared landing page', async () => {
  assert.equal(PHOTO_OPTIONS.length, 3);
  assert.equal(new Set(PHOTO_OPTIONS.map((photo) => photo.id)).size, 3);
  assert.equal(new Set(PHOTO_OPTIONS.map((photo) => photo.assetUrl)).size, 3);
  assert.equal(PRODUCT_LAUNCH_SELECTED_PHOTO_ID, 'option-2');
  assert.ok(!productLaunchFilesAt(tourTime(52000) - 1).some((file) => file.id === 'app'));
  assert.equal(productLaunchFilesAt(tourTime(52_000)).find((file) => file.id === 'app')?.draft, false);
  assert.ok(
    productLaunchStateAt(tourTime(52_000)).messages.some((message) => /photo option 2/.test(message.text)),
  );
  const html = await readFile(new URL('../public/demo/astra-hq-landing-page.html', import.meta.url), 'utf8');
  const photo = await readFile(new URL('../public/demo/marketing-photo-2.png', import.meta.url));
  const embeddedPhoto = `data:image/png;base64,${photo.toString('base64')}`;
  assert.equal(html, productLaunchLandingHTML(embeddedPhoto));
  assert.ok(html.includes(`src="${embeddedPhoto}"`));
  assert.ok(!html.includes('src="marketing-photo-2.png"'));
  assert.match(html, /href="#team"/);
  assert.match(html, /id="team"/);
  assert.match(html, /id="how-it-works"/);
  assert.ok(!html.includes('<script'));
});

test('all four employees discuss their work in staged group chat before the demo ends', () => {
  const teamIds = [...PRODUCT_LAUNCH_TEAM.map((employee) => employee.id), PRODUCT_LAUNCH_INTERN.id].sort();
  const workingChat = productLaunchChatAt(tourTime(16_000));
  assert.deepEqual([...new Set(workingChat.map((message) => message.authorId))].sort(), teamIds);
  assert.ok(workingChat.every((message) => message.channel === 'team'));
  for (const entry of PRODUCT_LAUNCH_CHAT) {
    assert.ok(!productLaunchChatAt(entry.at - 1).some((message) => message.id === entry.id));
    assert.ok(productLaunchChatAt(entry.at).some((message) => message.id === entry.id));
    assert.ok(entry.at >= 0 && entry.at < TOUR_DURATION);
  }
  const final = productLaunchStateAt(TOUR_DURATION);
  const chat = final.messages.filter((message) => message.channel === 'team');
  assert.equal(chat.length, PRODUCT_LAUNCH_CHAT.length);
  assert.ok(chat.some((message) => message.authorId === 'finance-bro' && message.text.includes('$16,850')));
  assert.ok(
    chat.some((message) => message.authorId === 'assistant' && message.text.includes('Thrive Capital')),
  );
  assert.ok(chat.some((message) => message.authorId === 'assistant' && message.text.includes('calendar')));
  assert.ok(chat.some((message) => message.authorId === 'software-engineer' && message.text.includes('PR')));
  const handoff = chat.findIndex((message) => message.id === 'demo-chat-handoff');
  const receipt = chat.findIndex((message) => message.id === 'demo-chat-landing');
  assert.ok(handoff >= 0 && receipt > handoff);
  assert.match(chat[handoff].text, /photo option 2/);
  assert.deepEqual(
    [
      ...new Set(
        chat
          .filter((message) => message.id.startsWith('demo-chat-celebrate-'))
          .map((message) => message.authorId),
      ),
    ].sort(),
    teamIds,
  );
  assert.ok(!JSON.stringify(final).includes('sessionId'));
});
