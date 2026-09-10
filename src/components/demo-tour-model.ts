/** Deterministic fixtures for the scripted tour. No native APIs or persisted app state. */
export const TOUR_DURATION = 28_000;
/** Convert the original 60-second story schedule to the current playback duration. */
export function tourTime(storyMilliseconds: number): number {
  return Math.round((storyMilliseconds * TOUR_DURATION) / 60_000);
}
export const TOUR_GOAL = 'Astra HQ Product Launch';
export const TOUR_GOAL_DESCRIPTION =
  'Build our app, forecast profits, coordinate the launch, and create the marketing campaign.';
export const TOUR_SLOGAN = 'A little office. A very big idea.';
export const TOUR_PHASES = [
  {
    id: 'hire',
    at: tourTime(0),
    title: 'Make room for one more.',
    detail: 'Hire a Marketing Intern to round out the team.',
  },
  {
    id: 'goal',
    at: tourTime(6000),
    title: 'Give everyone a shared goal.',
    detail: 'One idea. Four people moving it forward.',
  },
  {
    id: 'roadmap',
    at: tourTime(12000),
    title: 'A plan becomes a roadmap.',
    detail: 'Clear owners, small milestones, one launch.',
  },
  {
    id: 'work',
    at: tourTime(16000),
    title: 'The whole office gets to work.',
    detail: 'Engineering, finance, operations, and marketing.',
  },
  {
    id: 'email',
    at: tourTime(19000),
    title: 'Thrive Capital would like to meet.',
    detail: 'A fictional email arrives. Your Assistant prepares the reply.',
  },
  {
    id: 'email-approval',
    at: tourTime(24000),
    title: 'You have the final say.',
    detail: 'Review the draft before approving the sample reply.',
  },
  {
    id: 'meeting',
    at: tourTime(27000),
    title: 'A meeting, on the calendar.',
    detail: 'Avery prepares the sample Thrive Capital walkthrough for Thursday at 10 AM ET.',
  },
  {
    id: 'bug',
    at: tourTime(31000),
    title: 'A bug? Already on it.',
    detail: 'Your Software Engineer prepares a small, reviewable fix.',
  },
  {
    id: 'pr-approval',
    at: tourTime(34000),
    title: 'Review. Approve. Keep moving.',
    detail: 'A sample pull request, ready for your approval.',
  },
  {
    id: 'finance',
    at: tourTime(37000),
    title: 'Put some numbers behind the idea.',
    detail: 'Finance Bro builds a three-month profit model.',
  },
  {
    id: 'slogan',
    at: tourTime(41000),
    title: 'Find the words.',
    detail: 'Your Marketing Intern writes the launch slogan and HTML.',
  },
  {
    id: 'photo',
    at: tourTime(45000),
    title: 'Three directions. Pick your favorite.',
    detail: 'Swipe through the campaign photos and choose a launch image.',
  },
  {
    id: 'handoff',
    at: tourTime(52000),
    title: 'From marketing to engineering.',
    detail: 'Morgan hands the selected photo to Alex, who prepares the landing page.',
  },
  {
    id: 'campaign-approval',
    at: tourTime(55000),
    title: 'One last look. Ready to launch.',
    detail: 'Approve the sample campaign. Every file stays here to explore.',
  },
  {
    id: 'done',
    at: TOUR_DURATION,
    title: 'One goal. A whole team of progress.',
    detail: 'Back in the office. Your 28-second launch demo is complete; the sample files are ready.',
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
  { at: tourTime(0), target: 'employees-nav', click: tourTime(240) },
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
