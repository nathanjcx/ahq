/** Deterministic fixtures for the scripted tour. No native APIs or persisted app state. */
export const TOUR_DURATION = 120_000;
/** Legacy story beats mapped to a paced, two-minute walkthrough. */
const TOUR_TIME_ANCHORS: readonly (readonly [number, number])[] = [
  [0, 0],
  [350, 7000],
  [1000, 8000],
  [1350, 8500],
  [2250, 10500],
  [2450, 11000],
  [3850, 14000],
  [4300, 14500],
  [5200, 15700],
  [5500, 16000],
  [6000, 19500],
  [6500, 20000],
  [7300, 21000],
  [10700, 27500],
  [11500, 28500],
  [11800, 29000],
  [12000, 29300],
  [13000, 30000],
  [16000, 33000],
  [19000, 46000],
  [19600, 47000],
  [20000, 48000],
  [22100, 50000],
  [23500, 54000],
  [24000, 55000],
  [25700, 57500],
  [26000, 58000],
  [27000, 60000],
  [27100, 60050],
  [27600, 60400],
  [30500, 64000],
  [30800, 64200],
  [31000, 68000],
  [32100, 70000],
  [34000, 73000],
  [35700, 74700],
  [36000, 75000],
  [37000, 77000],
  [37100, 77100],
  [37600, 77500],
  [40500, 81000],
  [41000, 84000],
  [41300, 84300],
  [44500, 87300],
  [45000, 90000],
  [45400, 90400],
  [46700, 92500],
  [47200, 93500],
  [48000, 94500],
  [48500, 95500],
  [49300, 96500],
  [49800, 97500],
  [51000, 98500],
  [51600, 99200],
  [52000, 101000],
  [52400, 103000],
  [54800, 106500],
  [55000, 108000],
  [55300, 108500],
  [57700, 111500],
  [58000, 112000],
  [58400, 112500],
  [60000, 120000],
];
/** Keep existing story events in order, with longer office and review passages. */
export function tourTime(storyMilliseconds: number): number {
  const story = Math.max(0, Math.min(60_000, Number.isNaN(storyMilliseconds) ? 0 : storyMilliseconds));
  for (let index = 1; index < TOUR_TIME_ANCHORS.length; index++) {
    const [nextStory, nextElapsed] = TOUR_TIME_ANCHORS[index];
    if (story > nextStory) continue;
    const [previousStory, previousElapsed] = TOUR_TIME_ANCHORS[index - 1];
    const progress = (story - previousStory) / (nextStory - previousStory);
    return Math.round(previousElapsed + progress * (nextElapsed - previousElapsed));
  }
  return TOUR_DURATION;
}
export const TOUR_GOAL = 'Astra HQ Product Launch';
export const TOUR_GOAL_DESCRIPTION =
  'Build our app, forecast profits, coordinate the launch, and create the marketing campaign.';
export const TOUR_SLOGAN = 'A little office. A very big idea.';
export const TOUR_PHASES = [
  {
    id: 'office-intro',
    at: tourTime(0),
    title: 'Your office. You are the CEO.',
    detail:
      'Run a team of AI employees that can work around the clock. Their roles, progress, and conversations live here. You set the direction and approve their work.',
  },
  {
    id: 'hire',
    at: tourTime(350),
    title: 'Create an employee.',
    detail:
      'Choose a name and role, then generate a working personality. Morgan joins as Marketing Intern alongside Engineering, Finance, and your Assistant.',
  },
  {
    id: 'welcome',
    at: tourTime(5500),
    title: 'Meet your newest teammate.',
    detail:
      'Morgan now appears in the office with a name and role. Everyone has a place on the team before you give them a shared goal.',
  },
  {
    id: 'goal',
    at: tourTime(6000),
    title: 'Give the team a goal.',
    detail:
      'As CEO, describe the outcome you want. For this launch, the team will build the app, forecast profits, coordinate a meeting, and create the campaign.',
  },
  {
    id: 'roadmap',
    at: tourTime(12000),
    title: 'Turn the goal into a plan.',
    detail:
      'The roadmap breaks your goal into milestones with clear owners. Connected steps show what can start now and what depends on another teammate.',
  },
  {
    id: 'work',
    at: tourTime(16000),
    title: 'Watch your team work together.',
    detail:
      'Follow everyone’s progress in the office chat. When an employee needs your attention, an ! appears above them. Click it to review their work right here.',
  },
  {
    id: 'email',
    at: tourTime(19000),
    title: 'Your Assistant can handle email.',
    detail:
      'A fictional Thrive Capital email asks for a meeting. Avery drafts a reply, then raises an ! in the office. Click Avery’s ! to read the draft.',
  },
  {
    id: 'email-approval',
    at: tourTime(24000),
    title: 'You approve the reply.',
    detail:
      'Avery’s ! opens the reply for your approval while the team keeps working in the office. Read it before deciding; this sample reply sends nothing.',
  },
  {
    id: 'meeting',
    at: tourTime(27000),
    title: 'They can arrange the meeting.',
    detail:
      'Click Avery’s next ! to review the prepared calendar invitation. Check the time, attendees, and agenda, then close the preview to return to your team.',
  },
  {
    id: 'bug',
    at: tourTime(31000),
    title: 'Engineering picks up a bug.',
    detail:
      'A sample roadmap bug reaches Alex, your Software Engineer. Alex prepares a fix and raises an ! in the office so you can inspect the proposed change.',
  },
  {
    id: 'pr-approval',
    at: tourTime(34000),
    title: 'Review the proposed code change.',
    detail:
      'Clicking Alex’s ! opens the pull request. Review the change and checks, then approve or ask for revisions. Your office stays behind the review.',
  },
  {
    id: 'finance',
    at: tourTime(37000),
    title: 'Finance builds the forecast.',
    detail:
      'Blake’s ! brings the forecast to you. Click it to review pricing, customer counts, costs, and potential profit without leaving the office.',
  },
  {
    id: 'office-finance',
    at: tourTime(40550),
    title: 'Progress comes back to the office.',
    detail:
      'Finance shares the forecast with the team. Office chat keeps their work connected to the goal while Marketing prepares the next piece.',
  },
  {
    id: 'slogan',
    at: tourTime(41000),
    title: 'Marketing finds the words.',
    detail:
      'Morgan raises an ! with the launch slogan and campaign copy. Click Morgan to review the words; the team will reuse them as the product takes shape.',
  },
  {
    id: 'office-marketing',
    at: tourTime(44550),
    title: 'One team, one campaign.',
    detail:
      'Marketing shares the creative direction in office chat. You can see the plan come together without losing track of the other employees.',
  },
  {
    id: 'photo',
    at: tourTime(45000),
    title: 'Choose the campaign image.',
    detail:
      'Click Morgan’s ! to compare three campaign photos. Swipe through the options, select a favorite, and hand it to Engineering for the launch page.',
  },
  {
    id: 'office-handoff',
    at: tourTime(51650),
    title: 'See the handoff happen.',
    detail:
      'Morgan shares the selected photo with Alex in the office. One employee’s output becomes the next employee’s starting point.',
  },
  {
    id: 'handoff',
    at: tourTime(52000),
    title: 'Engineering builds on Marketing’s work.',
    detail:
      'Alex’s ! opens the prepared landing page with Marketing’s chosen image. Review the finished page directly from your employee in the office.',
  },
  {
    id: 'office-review',
    at: tourTime(54850),
    title: 'The team brings it back to you.',
    detail:
      'The launch pieces are ready for your final judgment. Employees report back in the office so you can review the result together.',
  },
  {
    id: 'campaign-approval',
    at: tourTime(55000),
    title: 'Keep the final say.',
    detail:
      'Click Morgan’s ! for the final launch kit approval. Review the forecast, campaign image, and landing page together. Your approval completes the sample goal; nothing is published or sent.',
  },
  {
    id: 'office-celebration',
    at: tourTime(58400),
    title: 'One goal. A whole team of progress.',
    detail:
      'Back in the office, everyone celebrates the finished launch. The chat shows each contribution, and all seven sample files remain available to explore.',
  },
  {
    id: 'done',
    at: TOUR_DURATION,
    title: 'Your office is ready for the next idea.',
    detail:
      'The two-minute walkthrough is complete. Explore the sample files, replay the story, or exit the demo to return to your live workspace.',
  },
] as const;
export type TourPhase = (typeof TOUR_PHASES)[number]['id'];
export type TourArtifactId = 'app' | 'meeting' | 'email' | 'pr' | 'profits' | 'slogan' | 'photo';
export const TOUR_ARTIFACTS: { id: TourArtifactId; name: string; owner: string; at: number; type: string }[] =
  [
    {
      id: 'app',
      name: 'Astra HQ landing page',
      owner: 'Software Engineer',
      at: tourTime(52_000),
      type: 'HTML',
    },
    { id: 'meeting', name: 'Thrive Capital meeting', owner: 'Assistant', at: tourTime(27_000), type: 'ICS' },
    { id: 'email', name: 'Reply to Thrive Capital', owner: 'Assistant', at: tourTime(26_000), type: 'EML' },
    { id: 'pr', name: 'Bug fix · PR #12', owner: 'Software Engineer', at: tourTime(36_000), type: 'DIFF' },
    { id: 'profits', name: 'Potential profits', owner: 'Finance Bro', at: tourTime(41_000), type: 'XLSX' },
    { id: 'slogan', name: 'Launch slogan', owner: 'Marketing Intern', at: tourTime(45_000), type: 'HTML' },
    {
      id: 'photo',
      name: 'Campaign photo options',
      owner: 'Marketing Intern',
      at: tourTime(51_000),
      type: 'PNG',
    },
  ];
const MOVES = [
  { at: tourTime(0), target: 'nav-office' },
  { at: tourTime(350), target: 'employees-nav', click: tourTime(500) },
  { at: tourTime(700), target: 'new-employee', click: tourTime(1000) },
  { at: tourTime(1300), target: 'hire-name' },
  { at: tourTime(2700), target: 'hire-role' },
  { at: tourTime(4900), target: 'hire-create', click: tourTime(5300) },
  { at: tourTime(6500), target: 'goal-input' },
  { at: tourTime(11_200), target: 'goal-create', click: tourTime(11_600) },
  { at: tourTime(13_000), target: 'roadmap-start', click: tourTime(15_600) },
  { at: tourTime(16_000), target: 'team-working' },
  { at: tourTime(19_000), target: 'email-notice', click: tourTime(19_600) },
  { at: tourTime(20_000), target: 'email-draft' },
  { at: tourTime(24_000), target: 'email-approve', click: tourTime(25_800) },
  { at: tourTime(27_000), target: 'file-meeting', click: tourTime(27_600) },
  { at: tourTime(31_000), target: 'bug-notice', click: tourTime(31_600) },
  { at: tourTime(32_000), target: 'pr-diff' },
  { at: tourTime(34_000), target: 'pr-approve', click: tourTime(35_800) },
  { at: tourTime(37_000), target: 'profit-sheet' },
  { at: tourTime(41_000), target: 'slogan-code' },
  { at: tourTime(45_000), target: 'photo-preview' },
  { at: tourTime(47_000), target: 'photo-next', click: tourTime(47_500) },
  { at: tourTime(48_500), target: 'photo-next', click: tourTime(49_000) },
  { at: tourTime(50_000), target: 'photo-previous', click: tourTime(50_500) },
  { at: tourTime(51_000), target: 'photo-handoff', click: tourTime(51_500) },
  { at: tourTime(52_000), target: 'file-app', click: tourTime(52_500) },
  { at: tourTime(55_000), target: 'campaign-approve', click: tourTime(57_800) },
  { at: tourTime(59_000), target: 'nav-office', click: tourTime(59_500) },
];
export function tourFrame(milliseconds: number) {
  const elapsed = Math.max(0, Math.min(TOUR_DURATION, Number.isFinite(milliseconds) ? milliseconds : 0));
  const phase = [...TOUR_PHASES].reverse().find((item) => elapsed >= item.at)!;
  const move = [...MOVES].reverse().find((item) => elapsed >= item.at)!;
  return {
    elapsed,
    phase,
    target: move.target,
    clicking:
      elapsed < TOUR_DURATION && 'click' in move && elapsed >= move.click! && elapsed < move.click! + 280,
    internHired: elapsed >= tourTime(5500),
    roadmapReady: elapsed >= tourTime(13_000),
    emailApproved: elapsed >= tourTime(26_000),
    prApproved: elapsed >= tourTime(36_000),
    campaignApproved: elapsed >= tourTime(58_000),
    complete: elapsed >= TOUR_DURATION,
    files: TOUR_ARTIFACTS.filter((item) => elapsed >= item.at),
  };
}
export function tourTyping(text: string, elapsed: number, from: number, to: number) {
  const progress = Math.max(0, Math.min(1, (elapsed - from) / Math.max(1, to - from)));
  return text.slice(0, Math.floor(progress * text.length));
}
export const TOUR_FORECAST = [
  { month: 'October', customers: 100, revenue: 2900, costs: 1600, profit: 1300 },
  { month: 'November', customers: 250, revenue: 7250, costs: 2400, profit: 4850 },
  { month: 'December', customers: 500, revenue: 14500, costs: 3800, profit: 10700 },
];
export const TOUR_EMAIL =
  'Hi Thrive Capital team,\n\nThanks for your interest in Astra HQ! Thursday, October 15 at 10:00 AM ET works well. I will create a 30-minute calendar invitation for our product launch walkthrough.\n\nWe will cover the office, our roadmap, and the launch plan. Looking forward to showing you around.\n\nBest,\nAvery';
export const TOUR_DIFF =
  'diff --git a/src/roadmap.ts b/src/roadmap.ts\n--- a/src/roadmap.ts\n+++ b/src/roadmap.ts\n@@ -8,3 +8,3 @@\n- const progress = completed / total * 100;\n+ const progress = total > 0 ? completed / total * 100 : 0;\n  return Math.min(100, progress);\n';
