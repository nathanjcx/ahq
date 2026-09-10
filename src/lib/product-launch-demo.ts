import type {
  AppState,
  Approval,
  Commitment,
  Employee,
  LocalFileEntry,
  Message,
  WorkspaceFolder,
} from '../../shared/types';
import {
  TOUR_DIFF,
  TOUR_EMAIL,
  TOUR_FORECAST,
  TOUR_GOAL,
  TOUR_GOAL_DESCRIPTION,
  TOUR_SLOGAN,
  tourFrame,
  tourTime,
  tourTyping,
} from '../components/demo-tour-model';
import type { TourArtifactId } from '../components/demo-tour-model';

/** In-memory fixtures for the real app's scripted tour. Never persisted or sent to a native API. */
export const PRODUCT_LAUNCH_TEAM: Employee[] = [
  {
    id: 'software-engineer',
    name: 'Alex',
    jobTitle: 'Software Engineer',
    personality: 'Thoughtful, practical, and precise. Turns ideas into reliable product changes.',
    skills: 'React, TypeScript, testing, desktop applications',
    color: '#658b78',
    avatar: 0,
    status: 'ready',
    activity: 'Creating the Astra HQ application',
    location: 'desk',
    appearance: {
      gender: 'masculine',
      skin: '#bd8967',
      hair: '#3b302b',
      hairstyle: 'short',
      hat: 'none',
      glasses: true,
      clothing: '#648371',
    },
  },
  {
    id: 'finance-bro',
    name: 'Blake',
    jobTitle: 'Finance Bro',
    personality: 'Numbers-first and commercially minded. Turns assumptions into useful profit scenarios.',
    skills: 'Excel, forecasting, financial models',
    color: '#b59058',
    avatar: 1,
    status: 'ready',
    activity: 'Creating an Excel sheet and potential profit scenarios',
    location: 'library',
    appearance: {
      gender: 'masculine',
      skin: '#e5b995',
      hair: '#725035',
      hairstyle: 'short',
      hat: 'none',
      glasses: false,
      clothing: '#ab8956',
    },
  },
  {
    id: 'assistant',
    name: 'Avery',
    jobTitle: 'Assistant',
    personality: 'Warm, organized, and proactive. Keeps meetings moving and replies clear.',
    skills: 'Meeting prep, scheduling, email replies',
    color: '#8b7caa',
    avatar: 2,
    status: 'ready',
    activity: 'Creating meetings and replying to email',
    location: 'meeting',
    appearance: {
      gender: 'feminine',
      skin: '#815844',
      hair: '#292524',
      hairstyle: 'long',
      hat: 'none',
      glasses: false,
      clothing: '#8a7a9d',
    },
  },
];
export const PRODUCT_LAUNCH_INTERN: Employee = {
  id: 'demo-marketing-intern',
  name: 'Morgan',
  jobTitle: 'Marketing Intern',
  personality:
    'Curious, creative, and full of fresh ideas. Writes memorable launch copy and makes warm, distinctive visuals. Checks the brief, asks for approval, and brings a little personality to every campaign.',
  skills: 'Copywriting, HTML, campaign visuals',
  color: '#ba8067',
  avatar: 3,
  status: 'ready',
  activity: 'Ready to create the launch campaign',
  location: 'desk',
  appearance: {
    gender: 'neutral',
    skin: '#d6a17c',
    hair: '#492e24',
    hairstyle: 'long',
    hat: 'beanie',
    glasses: false,
    clothing: '#b57860',
  },
};
export const PRODUCT_LAUNCH_APPROVAL_IDS = {
  email: 'demo-approval-email',
  pr: 'demo-approval-pr',
  campaign: 'demo-approval-launch-kit',
} as const;
export const PRODUCT_LAUNCH_COMMITMENT_IDS = {
  app: 'demo-milestone-app',
  profits: 'demo-milestone-profits',
  coordination: 'demo-milestone-coordination',
  marketing: 'demo-milestone-marketing',
  bug: 'demo-milestone-bug',
} as const;
const BASE_TIME = Date.parse('2026-10-15T13:59:00.000Z');
const at = (milliseconds: number) => new Date(BASE_TIME + milliseconds).toISOString();
const asset = (filename: string) => `${import.meta.env?.BASE_URL ?? './'}demo/${filename}`;
export const PHOTO_OPTIONS = [
  {
    id: 'option-1',
    title: 'A little world of ideas',
    assetUrl: asset('marketing-photo.png'),
    src: asset('marketing-photo.png'),
    alt: 'Sample campaign option one: a warm miniature team office',
  },
  {
    id: 'option-2',
    title: 'Your team, in its element',
    assetUrl: asset('marketing-photo-2.png'),
    src: asset('marketing-photo-2.png'),
    alt: 'Sample campaign option two: a bright, welcoming miniature office',
  },
  {
    id: 'option-3',
    title: 'Big ideas after hours',
    assetUrl: asset('marketing-photo-3.png'),
    src: asset('marketing-photo-3.png'),
    alt: 'Sample campaign option three: a thoughtfully lit miniature creative office',
  },
] as const;
export const PRODUCT_LAUNCH_PHOTO_OPTIONS = PHOTO_OPTIONS;
export const PRODUCT_LAUNCH_SELECTED_PHOTO_ID = 'option-2';
export const PRODUCT_LAUNCH_MEETING = {
  title: 'Astra HQ Product Launch × Thrive Capital',
  date: 'Thursday, October 15',
  time: '10:00–10:30 AM ET',
  attendees: ['Thrive Capital team (sample)', 'Avery · Assistant'],
  agenda: [
    'Meet the Astra HQ team',
    'Walk through the product launch roadmap',
    'Discuss the launch plan and next steps',
  ],
};
export const PRODUCT_LAUNCH_LANDING_PAGE = {
  headline: 'A little office. A very big idea.',
  description:
    'Meet the AI team that turns your next big idea into finished work. Set the goal, watch your office get moving, and keep the final say.',
  ctaLabel: 'Meet your team',
  features: [
    {
      title: 'Give the work a home',
      description: 'A shared office for your engineers, thinkers, planners, and makers.',
    },
    {
      title: 'Turn a goal into a plan',
      description: 'A clear roadmap, the right owners, and visible progress at every step.',
    },
    {
      title: 'Keep the final say',
      description: 'Review the files and approve the decisions before anything goes out.',
    },
  ],
};
const allEmployees = () => structuredClone([...PRODUCT_LAUNCH_TEAM, PRODUCT_LAUNCH_INTERN]);
const byteSize = (text: string) => new TextEncoder().encode(text).byteLength;

export type ProductLaunchPreviewKind = 'html' | 'markdown' | 'spreadsheet' | 'image';
export interface ProductLaunchDemoFile extends LocalFileEntry {
  id: TourArtifactId;
  title: string;
  ownerId: string;
  availableAt: number;
  readyAt: number;
  draft: boolean;
  mediaType: string;
  previewKind: ProductLaunchPreviewKind;
  /** HTML for HTML previews; readable Markdown for every other preview. */
  content: string;
  /** Exact bytes-as-text for downloadable text files, including EML/ICS/diff formatting. */
  downloadContent?: string;
  assetUrl?: string;
  downloadName: string;
}

function sampleHTML(title: string, body: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Sample</title><style>body{margin:0;background:#f6f2e5;color:#304738;font:18px system-ui}main{max-width:850px;margin:8vh auto;padding:40px}small{letter-spacing:2px}h1{font:70px Georgia;line-height:1.05}p{line-height:1.7}.team{display:flex;gap:12px;flex-wrap:wrap}.card{background:#fffdf5;border:1px solid #d8ddc8;padding:22px;border-radius:12px}footer{margin-top:45px;font-size:12px;color:#6b7767}</style><main><small>ASTRA HQ / SAMPLE LAUNCH FILE</small>${body}<footer>Scripted demo artifact. Fictional content. No live service or external action.</footer></main></html>`;
}
/** Prepared before playback; the scripted handoff reveals this completed local page. */
export function productLaunchLandingHTML(photoSource = 'marketing-photo-2.png') {
  const page = PRODUCT_LAUNCH_LANDING_PAGE;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Astra HQ — A little office. A very big idea.</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f8f6ed;color:#2e4838;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}a:focus-visible{outline:3px solid #95b079;outline-offset:6px}header,main,footer{max-width:1220px;margin:auto;padding-left:6%;padding-right:6%}header{display:flex;align-items:center;justify-content:space-between;padding-top:27px;padding-bottom:25px;border-bottom:1px solid #dde2d0}.logo{font:bold 25px Georgia,serif;letter-spacing:-1px}.logo span{color:#789664;margin-right:8px}nav{display:flex;gap:25px;font-size:12px;color:#7c8d6e}.nav-cta{border:1px solid #cad4bb;border-radius:4px;padding:7px 11px}.hero{display:grid;grid-template-columns:1fr 1fr;gap:6%;align-items:center;padding:72px 0 55px}.eyebrow{font-size:10px;letter-spacing:2px;color:#8b9c79;text-transform:uppercase}.hero h1{font:clamp(44px,5.2vw,72px)/1.04 Georgia,serif;letter-spacing:-3px;margin:18px 0 22px}.hero p{font-size:14px;line-height:1.85;color:#7c8d6f;max-width:430px}.button{display:inline-flex;gap:12px;align-items:center;background:#4e7042;color:#fffbed;padding:13px 19px;border-radius:5px;font-size:12px;margin-top:15px;box-shadow:0 3px 0 #3c5733}.button:hover{background:#3e6034}.hero-art{position:relative}.hero-art img{display:block;width:100%;aspect-ratio:1.05;object-fit:cover;border-radius:45% 45% 8px 8px;border:1px solid #d5ddc7}.photo-label{position:absolute;bottom:18px;left:18px;background:#fffff5e8;border:1px solid #e3e6d8;padding:10px 15px;border-radius:5px;font-size:10px;color:#859773}.photo-label strong{display:block;font-size:12px;color:#4b6741}.team-note{display:flex;align-items:center;gap:10px;margin-top:25px;color:#95a181;font-size:10px}.avatars{display:flex;gap:3px}.avatars span{display:grid;place-items:center;width:24px;height:27px;border-radius:4px;color:#fff6e8;font-size:11px;background:#72927b}.avatars span:nth-child(2){background:#b69861}.avatars span:nth-child(3){background:#9484ae}.avatars span:nth-child(4){background:#bd8c74}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:30px;margin:24px 0}.section-heading h2{font:34px/1.2 Georgia,serif;letter-spacing:-1px;margin:8px 0}.section-heading p{color:#92a081;font-size:12px;max-width:280px}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-bottom:55px}.feature{background:#fffef7;border:1px solid #dee4d1;border-radius:7px;padding:25px}.feature .number{font:24px Georgia,serif;color:#a2b48c}.feature h3{font-size:14px;margin:16px 0 8px}.feature p{font-size:12px;color:#94a282;line-height:1.8;margin:0}.team{padding:25px 30px;border:1px solid #d3dec2;background:#eef2e1;border-radius:7px;margin-bottom:40px;display:flex;align-items:center;justify-content:space-between;gap:20px}.team h2{font:28px Georgia,serif;margin:0 0 7px}.team p{font-size:12px;color:#8da077;margin:0}.team ul{margin:0;display:flex;gap:18px;padding:0;list-style:none;color:#78915f;font-size:10px}.team li{max-width:85px}.team strong{display:block;color:#506d41;font-size:12px}footer{display:flex;justify-content:space-between;gap:20px;padding-top:20px;padding-bottom:30px;border-top:1px solid #e0e6d4;font-size:10px;color:#a0ab91}.sample{font-size:8px;text-transform:uppercase;letter-spacing:1px}.selected{display:block;font-size:8px;color:#a0ad8a;margin-top:8px;text-align:right}@media(max-width:700px){header{padding-top:20px}nav{gap:12px;font-size:10px}.hero{grid-template-columns:1fr;padding-top:35px;gap:30px}.hero h1{font-size:57px}.hero-art img{aspect-ratio:1.3;border-radius:8px}.features{grid-template-columns:1fr}.section-heading,.team{display:block}.team ul{margin-top:22px;justify-content:space-between}.section-heading p{max-width:none}footer{display:block}.sample{margin-top:8px}.hero h1{letter-spacing:-2px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><header><a class="logo" href="#top"><span>✳</span>Astra HQ</a><nav aria-label="Page navigation"><a href="#how-it-works">How it works</a><a href="#team" class="nav-cta">Meet the team ↗</a></nav></header><main id="top"><section class="hero"><div><span class="eyebrow">A little space for big things</span><h1>${page.headline}</h1><p>${page.description}</p><a class="button" href="#team">${page.ctaLabel}<span aria-hidden="true">↗</span></a><div class="team-note"><div class="avatars"><span>A</span><span>B</span><span>A</span><span>M</span></div>One goal. A whole team behind it.</div></div><div class="hero-art"><img src="${photoSource}" alt="Selected campaign photograph: a welcoming miniature Astra HQ office"><div class="photo-label"><strong>Your idea has good company.</strong>Engineering. Finance. Operations. A little imagination.</div><span class="selected">Campaign image selected by Marketing · Page prepared by Engineering</span></div></section><section id="how-it-works"><div class="section-heading"><div><span class="eyebrow">From what if to what’s next</span><h2>A team that moves<br>your ideas forward.</h2></div><p>Less chasing tasks. More making things happen, together.</p></div><div class="features">${page.features.map((feature, i) => `<article class="feature"><span class="number">0${i + 1}</span><h3>${feature.title}</h3><p>${feature.description}</p></article>`).join('')}</div></section><section class="team" id="team"><div><h2>Pull up a chair.</h2><p>Your next big thing starts with a little team.</p></div><ul>${allEmployees()
    .map((employee) => `<li><strong>${employee.name}</strong>${employee.jobTitle}</li>`)
    .join(
      '',
    )}</ul></section></main><footer><span>✳ Astra HQ · A little office. A very big idea.</span><span class="sample">Prepared demo landing page · fictional sample · nothing published</span></footer></body></html>`;
}
export const PRODUCT_LAUNCH_PROFIT_CONTENT = [
  '# Potential profits',
  '**Sample forecast — illustrative assumptions, not actual revenue. USD.**',
  '',
  '| Month | Customers | Price | Revenue | Costs | Profit |',
  '| --- | --- | --- | --- | --- | --- |',
  ...TOUR_FORECAST.map(
    (row) =>
      `| ${row.month} | ${row.customers} | $29 | $${row.revenue.toLocaleString('en-US')} | $${row.costs.toLocaleString('en-US')} | $${row.profit.toLocaleString('en-US')} |`,
  ),
  '| Total | — | — | $24,650 | $7,800 | $16,850 |',
  '',
  'Revenue = customers × monthly subscription price. Profit = revenue − costs.',
  'Workbook total: G10 = SUM(G7:G9). The downloadable Excel workbook contains editable assumptions and formulas.',
].join('\n');
export const PRODUCT_LAUNCH_RECEIVED_EMAIL = {
  id: 'demo-incoming-email',
  sender: 'Thrive Capital team (sample)',
  address: 'team@thrivecapital.example',
  subject: 'Astra HQ launch walkthrough',
  content:
    'Hi Avery, the Thrive Capital team would love to meet and hear about the Astra HQ Product Launch. Could we schedule a walkthrough on Thursday at 10:00 AM ET? — Thrive Capital team (fictional sample)',
  at: tourTime(19_000),
};
export const PRODUCT_LAUNCH_BUG_REPORT = {
  id: 'demo-bug-report',
  title: 'Empty roadmaps show NaN% progress',
  content:
    'When there are no milestones, the roadmap progress displays NaN%. Expected: 0%. Sample bug report #12.',
  at: tourTime(31_000),
};
export const PRODUCT_LAUNCH_CHAT = [
  {
    at: tourTime(5500),
    id: 'demo-chat-intro',
    authorId: PRODUCT_LAUNCH_INTERN.id,
    text: 'Hi team! I’m Morgan. Ready to give this launch some personality.',
  },
  {
    at: tourTime(13000),
    id: 'demo-chat-build',
    authorId: 'software-engineer',
    text: 'Roadmap looks good. I’m on the app and landing page.',
  },
  {
    at: tourTime(14000),
    id: 'demo-chat-numbers',
    authorId: 'finance-bro',
    text: 'I’ve got the numbers. Let’s make this launch add up.',
  },
  {
    at: tourTime(15000),
    id: 'demo-chat-coordination',
    authorId: 'assistant',
    text: 'I’ll handle the inbox and get the launch meeting sorted.',
  },
  {
    at: tourTime(16000),
    id: 'demo-chat-creative',
    authorId: PRODUCT_LAUNCH_INTERN.id,
    text: 'On it! I’m testing slogans and three visual directions.',
  },
  {
    at: tourTime(19000),
    id: 'demo-chat-thrive',
    authorId: 'assistant',
    text: 'Heads up: Thrive Capital (sample) wants a launch walkthrough.',
  },
  {
    at: tourTime(19500),
    id: 'demo-chat-ready-to-show',
    authorId: 'software-engineer',
    text: 'Great. I’ll make sure the product is ready to show.',
  },
  {
    at: tourTime(26000),
    id: 'demo-chat-reply',
    authorId: 'assistant',
    text: 'Reply approved. Preparing Thursday’s 10 AM meeting now.',
  },
  {
    at: tourTime(27000),
    id: 'demo-chat-calendar',
    authorId: 'assistant',
    text: 'Sample calendar invite ready: Thursday, 10 AM ET. Click the ! above me to review it.',
  },
  {
    at: tourTime(31000),
    id: 'demo-chat-bug',
    authorId: 'software-engineer',
    text: 'Found the empty-roadmap bug. Tiny fix, PR #12 coming up.',
  },
  {
    at: tourTime(35000),
    id: 'demo-chat-small-fix',
    authorId: 'finance-bro',
    text: 'Love a launch-day fix that fits on one line.',
  },
  {
    at: tourTime(36000),
    id: 'demo-chat-pr',
    authorId: 'software-engineer',
    text: 'PR approved. All three sample checks passed.',
  },
  {
    at: tourTime(37000),
    id: 'demo-chat-profit',
    authorId: 'finance-bro',
    text: 'Forecast’s ready: $16,850 potential profit in three months. Assumptions are in Excel.',
  },
  {
    at: tourTime(39000),
    id: 'demo-chat-headline-reaction',
    authorId: PRODUCT_LAUNCH_INTERN.id,
    text: 'That deserves a good headline.',
  },
  {
    at: tourTime(41000),
    id: 'demo-chat-slogan',
    authorId: PRODUCT_LAUNCH_INTERN.id,
    text: '“A little office. A very big idea.” How does that feel?',
  },
  {
    at: tourTime(42500),
    id: 'demo-chat-slogan-reaction',
    authorId: 'assistant',
    text: 'Feels like us. Clear, warm, and easy to remember.',
  },
  {
    at: tourTime(45000),
    id: 'demo-chat-photo-options',
    authorId: PRODUCT_LAUNCH_INTERN.id,
    text: 'Three photo options are ready. Swipe through and pick a favorite.',
  },
  {
    at: tourTime(50000),
    id: 'demo-chat-photo-choice',
    authorId: 'software-engineer',
    text: 'Option 2 gives the hero some room to breathe.',
  },
  {
    at: tourTime(52000),
    id: 'demo-chat-handoff',
    authorId: PRODUCT_LAUNCH_INTERN.id,
    text: 'Alex, here’s photo option 2 for the landing page.',
  },
  {
    at: tourTime(52600),
    id: 'demo-chat-landing',
    authorId: 'software-engineer',
    text: 'Got it. The selected image is in the prepared landing page—ready to review.',
  },
  {
    at: tourTime(55000),
    id: 'demo-chat-finance-check',
    authorId: 'finance-bro',
    text: 'Numbers checked. Launch kit looks good from finance.',
  },
  {
    at: tourTime(58000),
    id: 'demo-chat-celebrate-assistant',
    authorId: 'assistant',
    text: 'Approved! The sample meeting and launch files are all ready.',
  },
  {
    at: tourTime(58300),
    id: 'demo-chat-celebrate-finance',
    authorId: 'finance-bro',
    text: 'All green. The spreadsheet is officially off my desk.',
  },
  {
    at: tourTime(58600),
    id: 'demo-chat-celebrate-marketing',
    authorId: PRODUCT_LAUNCH_INTERN.id,
    text: 'Our little office did a big thing ✨',
  },
  {
    at: tourTime(59000),
    id: 'demo-chat-celebrate-engineer',
    authorId: 'software-engineer',
    text: 'Nice work, team. Astra HQ is ready for its close-up.',
  },
] as const;

/** Staged, fictional team discussion. Every returned message belongs only to this sample workspace. */
export function productLaunchChatAt(milliseconds: number): Message[] {
  const elapsed = tourFrame(milliseconds).elapsed;
  return PRODUCT_LAUNCH_CHAT.filter((message) => elapsed >= message.at).map((message) => ({
    id: message.id,
    authorId: message.authorId,
    channel: 'team',
    text: message.text,
    time: at(message.at),
  }));
}

/** Complete sample file; no disk path here refers to a user's real workspace. */
export function productLaunchFile(id: TourArtifactId): ProductLaunchDemoFile {
  const fixture = fileFixture(id);
  return {
    ...fixture,
    id,
    path: `demo://product-launch/${fixture.downloadName}`,
    relativePath: `sample-launch/${fixture.downloadName}`,
    name: fixture.downloadName,
    kind: id === 'photo' ? 'asset' : 'document',
    size:
      id === 'photo'
        ? 2_323_492
        : id === 'profits'
          ? 4565
          : byteSize(fixture.downloadContent ?? fixture.content),
    modifiedAt: BASE_TIME + fixture.readyAt,
    draft: false,
  };
}
type FileFixture = Pick<
  ProductLaunchDemoFile,
  | 'title'
  | 'ownerId'
  | 'availableAt'
  | 'readyAt'
  | 'mediaType'
  | 'previewKind'
  | 'content'
  | 'downloadContent'
  | 'assetUrl'
  | 'downloadName'
>;
function fileFixture(id: TourArtifactId): FileFixture {
  if (id === 'app') {
    const content = productLaunchLandingHTML(asset('marketing-photo-2.png'));
    return {
      title: 'Astra HQ launch landing page',
      ownerId: 'software-engineer',
      availableAt: tourTime(52_000),
      readyAt: tourTime(52_000),
      mediaType: 'text/html',
      previewKind: 'html',
      content,
      downloadContent: productLaunchLandingHTML(),
      downloadName: 'astra-hq-landing-page.html',
      assetUrl: asset('astra-hq-landing-page.html'),
    };
  }
  if (id === 'meeting')
    return {
      title: PRODUCT_LAUNCH_MEETING.title,
      ownerId: 'assistant',
      availableAt: tourTime(27_000),
      readyAt: tourTime(27_000),
      mediaType: 'text/calendar',
      previewKind: 'markdown',
      downloadName: 'sample-launch-meeting.ics',
      content: `# ${PRODUCT_LAUNCH_MEETING.title}\n\n**Fictional sample calendar event. Not scheduled or sent.**\n\n${PRODUCT_LAUNCH_MEETING.date} · ${PRODUCT_LAUNCH_MEETING.time}\n\n${PRODUCT_LAUNCH_MEETING.attendees.join(' + ')}\n\n${PRODUCT_LAUNCH_MEETING.agenda.map((item) => `- ${item}`).join('\n')}\n\nAvery replied to the sample Thrive Capital email and prepared this event.`,
      downloadContent:
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Astra HQ//Sample Demo//EN\r\nBEGIN:VEVENT\r\nUID:sample-thrive-launch-meeting@astra-hq.example\r\nDTSTAMP:20260910T000000Z\r\nDTSTART:20261015T140000Z\r\nDTEND:20261015T143000Z\r\nSUMMARY:[SAMPLE] Astra HQ Product Launch × Thrive Capital\r\nDESCRIPTION:Fictional demo meeting. Not scheduled or sent.\r\nATTENDEE;CN=Thrive Capital team (sample):mailto:team@thrivecapital.example\r\nSTATUS:TENTATIVE\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    };
  if (id === 'email')
    return {
      title: 'Reply to Thrive Capital',
      ownerId: 'assistant',
      availableAt: tourTime(20_000),
      readyAt: tourTime(26_000),
      mediaType: 'message/rfc822',
      previewKind: 'markdown',
      downloadName: 'sample-launch-reply.eml',
      content: emailContent(TOUR_EMAIL),
      downloadContent: `X-Astra-HQ-Demo: true\r\nTo: Thrive Capital team <team@thrivecapital.example>\r\nFrom: Avery <avery@astra-hq.example>\r\nSubject: [SAMPLE] Re: Astra HQ launch walkthrough\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nDEMO DRAFT ONLY — NOT SENT\r\n\r\n${TOUR_EMAIL.replaceAll('\n', '\r\n')}`,
    };
  if (id === 'pr')
    return {
      title: 'Fix empty roadmap progress · PR #12',
      ownerId: 'software-engineer',
      availableAt: tourTime(32_000),
      readyAt: tourTime(36_000),
      mediaType: 'text/plain',
      previewKind: 'markdown',
      downloadName: 'sample-roadmap-progress.diff',
      content: `# Fix empty roadmap progress · PR #12\n\n**Sample pull request. No real repository changed.**\n\nBranch: alex/fix-progress → main\n\n## Before\ncompleted / total * 100\n\n## After\ntotal > 0 ? completed / total * 100 : 0\n\n## Simulated checks\n- Empty roadmap shows 0%\n- Partly completed roadmap shows the correct percentage\n- Completed roadmap shows 100%\n\n3 simulated checks passed. Ready for your approval.`,
      downloadContent: `# SAMPLE PR #12 — Demo only; no real repository change\n# Fix empty roadmap progress\n# Simulated checks: empty roadmap, partial completion, completed roadmap\n\n${TOUR_DIFF}`,
    };
  if (id === 'profits')
    return {
      title: 'Potential profits',
      ownerId: 'finance-bro',
      availableAt: tourTime(37_000),
      readyAt: tourTime(41_000),
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      previewKind: 'spreadsheet',
      downloadName: 'sample-profit-forecast.xlsx',
      content: PRODUCT_LAUNCH_PROFIT_CONTENT,
      assetUrl: asset('profit-forecast.xlsx'),
    };
  if (id === 'slogan') {
    const content = sampleHTML(
      'Astra HQ launch campaign',
      `<h1>${TOUR_SLOGAN}</h1><p>Meet the team that turns “what if” into “done.”<br>Build. Plan. Create. All from your little office.</p><div class="card">Astra HQ Product Launch<br>Coming to an office near you.</div>`,
    );
    return {
      title: 'Launch slogan and HTML',
      ownerId: PRODUCT_LAUNCH_INTERN.id,
      availableAt: tourTime(41_000),
      readyAt: tourTime(45_000),
      mediaType: 'text/html',
      previewKind: 'html',
      content,
      downloadContent: content,
      downloadName: 'astra-hq-sample-campaign.html',
    };
  }
  return {
    title: 'Marketing campaign photo options',
    ownerId: PRODUCT_LAUNCH_INTERN.id,
    availableAt: tourTime(45_000),
    readyAt: tourTime(51_000),
    mediaType: 'image/png',
    previewKind: 'image',
    downloadName: 'sample-marketing-photo-2.png',
    content: `# Marketing campaign photo options\n\n${TOUR_SLOGAN}\n\nMorgan prepared three sample campaign options. Option 2 is selected for Alex to use on the landing page.`,
    assetUrl: asset('marketing-photo-2.png'),
  };
}
function emailContent(body: string) {
  return `# Re: Astra HQ launch walkthrough\n\n**Sample draft — not sent.**\n\nTo: Thrive Capital team <team@thrivecapital.example>\n\n${body}\n\nMeeting prepared: Thursday, October 15 · 10:00–10:30 AM ET.`;
}

export interface ProductLaunchOfficeReview {
  id: string;
  employeeId: string;
  label: string;
  approvalId?: string;
  fileId?: TourArtifactId;
}

const OFFICE_REVIEW_STEPS: (ProductLaunchOfficeReview & { from: number; until: number })[] = [
  {
    id: 'email',
    employeeId: fileFixture('email').ownerId,
    label: 'Review Avery’s email reply',
    approvalId: PRODUCT_LAUNCH_APPROVAL_IDS.email,
    from: tourTime(20_000),
    until: tourTime(26_000),
  },
  {
    id: 'meeting',
    employeeId: fileFixture('meeting').ownerId,
    label: 'Review Avery’s meeting invitation',
    fileId: 'meeting',
    from: tourTime(27_000),
    until: tourTime(30_500),
  },
  {
    id: 'pr',
    employeeId: fileFixture('pr').ownerId,
    label: 'Review Alex’s bug fix',
    approvalId: PRODUCT_LAUNCH_APPROVAL_IDS.pr,
    from: tourTime(32_000),
    until: tourTime(36_000),
  },
  {
    id: 'profits',
    employeeId: fileFixture('profits').ownerId,
    label: 'Review Blake’s profit forecast',
    fileId: 'profits',
    from: tourTime(37_000),
    until: tourTime(40_500),
  },
  {
    id: 'slogan',
    employeeId: fileFixture('slogan').ownerId,
    label: 'Review Morgan’s launch slogan',
    fileId: 'slogan',
    from: tourTime(41_000),
    until: tourTime(44_500),
  },
  {
    id: 'photo',
    employeeId: fileFixture('photo').ownerId,
    label: 'Review Morgan’s campaign images',
    fileId: 'photo',
    from: tourTime(45_000),
    until: tourTime(51_600),
  },
  {
    id: 'app',
    employeeId: fileFixture('app').ownerId,
    label: 'Review Alex’s landing page',
    fileId: 'app',
    from: tourTime(52_000),
    until: tourTime(54_800),
  },
  {
    id: 'campaign',
    employeeId: fileFixture('photo').ownerId,
    label: 'Approve Morgan’s launch kit',
    approvalId: PRODUCT_LAUNCH_APPROVAL_IDS.campaign,
    from: tourTime(55_000),
    until: tourTime(58_000),
  },
];

/** Review cues on the sample office's employees. Returns fresh data and never adds live approvals. */
export function productLaunchOfficeReviewsAt(milliseconds: number): ProductLaunchOfficeReview[] {
  const elapsed = tourFrame(milliseconds).elapsed;
  return OFFICE_REVIEW_STEPS.filter((review) => elapsed >= review.from && elapsed < review.until).map(
    ({ from: _from, until: _until, ...review }) => ({ ...review }),
  );
}

/** Files appear in the real Files page as soon as their scripted preview begins. */
export function productLaunchFilesAt(milliseconds: number): ProductLaunchDemoFile[] {
  const elapsed = tourFrame(milliseconds).elapsed;
  return (['app', 'meeting', 'email', 'pr', 'profits', 'slogan', 'photo'] as const)
    .map(productLaunchFile)
    .filter((file) => elapsed >= file.availableAt)
    .map((file) => {
      const result = { ...file, draft: elapsed < file.readyAt };
      if (file.id === 'email')
        result.content = emailContent(tourTyping(TOUR_EMAIL, elapsed, tourTime(20_000), tourTime(23_500)));
      if (file.id === 'slogan' && elapsed < tourTime(44_500)) {
        const headline = tourTyping(TOUR_SLOGAN, elapsed, tourTime(41_400), tourTime(42_700));
        const description = tourTyping(
          'Your AI workforce, together.',
          elapsed,
          tourTime(42_700),
          tourTime(44_500),
        );
        result.content = sampleHTML('Astra HQ launch campaign', `<h1>${headline}</h1><p>${description}</p>`);
      }
      return result;
    });
}

function commitmentsAt(elapsed: number): Commitment[] {
  if (elapsed < tourTime(13000)) return [];
  const make = (
    id: string,
    title: string,
    ownerId: string,
    description: string,
    doneAt: number,
    reviewAt: number,
    dependencies: string[] = [],
  ): Commitment => ({
    id,
    title,
    ownerId,
    description,
    recipient: 'Astra HQ Product Launch — sample workspace',
    deadline: '2026-10-15T17:00:00.000Z',
    firm: true,
    status:
      elapsed >= doneAt
        ? 'done'
        : elapsed >= reviewAt
          ? 'review'
          : elapsed >= tourTime(16000)
            ? 'in-progress'
            : 'planned',
    progress:
      elapsed >= doneAt
        ? 100
        : elapsed >= reviewAt
          ? 95
          : elapsed < tourTime(16000)
            ? 0
            : Math.min(
                90,
                Math.round(((elapsed - tourTime(16000)) / Math.max(1, reviewAt - tourTime(16000))) * 90),
              ),
    nextStep:
      elapsed >= doneAt
        ? 'Sample deliverable approved and ready to inspect.'
        : elapsed >= reviewAt
          ? 'Waiting for your sample approval.'
          : description,
    dependencies,
    source: 'Scripted product launch demo',
    definitionOfDone: 'A fictional, inspectable deliverable prepared for the Astra HQ Product Launch.',
  });
  const ids = PRODUCT_LAUNCH_COMMITMENT_IDS;
  const result = [
    make(
      ids.app,
      'Build the Astra HQ launch landing page',
      'software-engineer',
      'Build the application, then turn Marketing’s selected image into a landing page.',
      tourTime(58_000),
      tourTime(52_000),
    ),
    make(
      ids.profits,
      'Model potential profits in Excel',
      'finance-bro',
      'Create the three-month forecast with editable assumptions.',
      tourTime(58_000),
      tourTime(37_000),
    ),
    make(
      ids.coordination,
      'Coordinate the launch meeting and email',
      'assistant',
      'Prepare a walkthrough and draft the reply for approval.',
      tourTime(27_000),
      tourTime(20_000),
    ),
    make(
      ids.marketing,
      'Create the launch slogan and campaign photo',
      PRODUCT_LAUNCH_INTERN.id,
      'Write the launch HTML and prepare a campaign photograph.',
      tourTime(58_000),
      tourTime(45_000),
    ),
  ];
  if (elapsed >= tourTime(31_000))
    result.push(
      make(
        ids.bug,
        'Fix the empty roadmap progress bug',
        'software-engineer',
        'Prepare sample PR #12 and request approval.',
        tourTime(36_000),
        tourTime(32_000),
        [],
      ),
    );
  return result;
}
function approvalsAt(elapsed: number): Approval[] {
  const result: Approval[] = [];
  const common = {
    kind: 'document' as const,
    version: 1,
    sources: ['Fictional product launch demo'],
    recipient: 'Sample workspace only — no external action',
  };
  if (elapsed >= tourTime(20_000))
    result.push({
      ...common,
      id: PRODUCT_LAUNCH_APPROVAL_IDS.email,
      employeeId: 'assistant',
      commitmentId: PRODUCT_LAUNCH_COMMITMENT_IDS.coordination,
      title: 'Approve reply to Thrive Capital',
      summary:
        'Avery drafted a reply to the fictional Thrive Capital team. Approve it to prepare the calendar meeting.',
      content: emailContent(tourTyping(TOUR_EMAIL, elapsed, tourTime(20_000), tourTime(23_500))),
      createdAt: at(tourTime(20_000)),
      status: elapsed >= tourTime(26_000) ? 'approved' : 'pending',
    });
  if (elapsed >= tourTime(32_000))
    result.push({
      ...common,
      id: PRODUCT_LAUNCH_APPROVAL_IDS.pr,
      employeeId: 'software-engineer',
      commitmentId: PRODUCT_LAUNCH_COMMITMENT_IDS.bug,
      title: 'Approve bug fix · PR #12',
      summary: 'Alex fixed the sample empty-roadmap bug. Three simulated checks passed.',
      content: productLaunchFile('pr').content,
      createdAt: at(tourTime(32_000)),
      status: elapsed >= tourTime(36_000) ? 'approved' : 'pending',
    });
  if (elapsed >= tourTime(55_000))
    result.push({
      ...common,
      id: PRODUCT_LAUNCH_APPROVAL_IDS.campaign,
      employeeId: PRODUCT_LAUNCH_INTERN.id,
      commitmentId: PRODUCT_LAUNCH_COMMITMENT_IDS.marketing,
      title: 'Approve the Astra HQ launch kit',
      summary:
        'Review the forecast, selected campaign photo, and completed landing page before the sample launch.',
      content: `# Astra HQ Product Launch\n\n**Sample launch approval — nothing is published.**\n\n## Profit forecast\n$24,650 revenue − $7,800 costs = **$16,850 potential profit** over three months. Illustrative assumptions only.\n\n## Launch slogan\n${TOUR_SLOGAN}\n\n## Marketing → Engineering\nMorgan selected campaign photo option 2 and handed it to Alex. Alex used it to prepare the Astra HQ landing page.\n\n## Files ready for review\n- sample-profit-forecast.xlsx — Blake, Finance Bro\n- astra-hq-sample-campaign.html — Morgan, Marketing Intern\n- sample-marketing-photo-2.png — Morgan, Marketing Intern\n- astra-hq-landing-page.html — Alex, Software Engineer\n\nAll seven sample files remain in Files for inspection and download.`,
      createdAt: at(tourTime(55_000)),
      status: elapsed >= tourTime(58_000) ? 'approved' : 'pending',
    });
  return result;
}

/** Fresh state on every call: callers can edit this snapshot without mutating the fixtures. */
export function productLaunchStateAt(milliseconds: number): AppState {
  const frame = tourFrame(milliseconds),
    elapsed = frame.elapsed;
  const employees = allEmployees().slice(0, frame.internHired ? 4 : 3);
  const commitments = commitmentsAt(elapsed),
    approvals = approvalsAt(elapsed);
  for (const employee of employees) {
    const pending = approvals.find(
      (approval) => approval.employeeId === employee.id && approval.status === 'pending',
    );
    const work = commitments.filter((item) => item.ownerId === employee.id);
    employee.status =
      pending || work.some((item) => item.status === 'review')
        ? 'review'
        : work.some((item) => item.status === 'in-progress')
          ? 'working'
          : 'ready';
    if (pending) employee.activity = pending.summary;
    else if (work.length)
      employee.activity =
        work.find((item) => item.status !== 'done')?.description ?? 'Sample launch work is ready in Files.';
  }
  const files = productLaunchFilesAt(elapsed);
  // WorkspaceFolder represents text sources, whose ingestion schema caps file size at 500KB.
  // The binary workbook and photograph remain in the document/asset catalog above.
  const sourceFiles = files.filter((file) => file.downloadContent !== undefined);
  const folders: WorkspaceFolder[] = sourceFiles.length
    ? [
        {
          id: '8f5e2bb8-8a62-4b92-9e48-eac1caf11001',
          name: 'Astra HQ Product Launch — samples',
          createdAt: at(tourTime(20_000)),
          excludedCount: 0,
          files: sourceFiles.map((file) => ({
            path: file.relativePath,
            size: file.size,
            excerpt: file.content.slice(0, 1500),
          })),
        },
      ]
    : [];
  const eventFixtures = [
    {
      ms: tourTime(0),
      text: 'Sample office ready: Software Engineer, Finance Bro, and Assistant.',
      kind: 'system' as const,
    },
    {
      ms: tourTime(5500),
      text: 'Morgan joined the demo office as Marketing Intern.',
      employeeId: PRODUCT_LAUNCH_INTERN.id,
      kind: 'system' as const,
    },
    { ms: tourTime(11800), text: `New goal: ${TOUR_GOAL}`, kind: 'announcement' as const },
    {
      ms: tourTime(13000),
      text: 'Product launch roadmap generated with four owners.',
      kind: 'system' as const,
    },
    {
      ms: tourTime(16000),
      text: 'All four teammates are working on the sample launch.',
      kind: 'work' as const,
    },
    {
      ms: tourTime(19_000),
      text: 'Fictional Thrive Capital email received: the team requested a product launch meeting.',
      employeeId: 'assistant',
      kind: 'work' as const,
    },
    {
      ms: tourTime(26_000),
      text: 'Reply approved. Simulated send complete; no real email was sent.',
      employeeId: 'assistant',
      kind: 'review' as const,
    },
    {
      ms: tourTime(27_000),
      text: 'Avery created the sample Thrive Capital meeting for Thursday, October 15 at 10 AM ET.',
      employeeId: 'assistant',
      kind: 'work' as const,
    },
    {
      ms: tourTime(31_000),
      text: 'Sample bug reported: empty roadmap shows NaN% progress.',
      employeeId: 'software-engineer',
      kind: 'work' as const,
    },
    {
      ms: tourTime(36_000),
      text: 'Sample PR #12 approved. No real repository changed.',
      employeeId: 'software-engineer',
      kind: 'review' as const,
    },
    {
      ms: tourTime(52_000),
      text: 'Morgan handed campaign image option 2 to Alex. The prepared landing page is ready to preview.',
      employeeId: PRODUCT_LAUNCH_INTERN.id,
      kind: 'work' as const,
    },
    {
      ms: tourTime(58_000),
      text: 'Sample launch kit approved: forecast, slogan HTML, selected campaign photo, and landing page.',
      employeeId: PRODUCT_LAUNCH_INTERN.id,
      kind: 'review' as const,
    },
    {
      ms: tourTime(60_000),
      text: 'Astra HQ Product Launch demo complete. Seven sample files are ready to inspect.',
      kind: 'system' as const,
    },
  ];
  return {
    schemaVersion: 1,
    workspaceName: 'Astra HQ · Sample launch',
    goal: elapsed >= tourTime(11800) ? TOUR_GOAL : 'Give your team a goal to work toward.',
    reducedMotion: false,
    sound: false,
    demo: true,
    employees,
    commitments,
    approvals,
    folders,
    ...(elapsed >= tourTime(12000)
      ? {
          roadmap: {
            id: '8f5e2bb8-8a62-4b92-9e48-eac1caf11002',
            goal: TOUR_GOAL,
            status:
              elapsed < tourTime(13000)
                ? ('planning' as const)
                : frame.complete
                  ? ('complete' as const)
                  : ('active' as const),
            message:
              elapsed < tourTime(13000)
                ? 'Creating your sample product launch roadmap…'
                : frame.complete
                  ? 'All sample launch work is complete.'
                  : TOUR_GOAL_DESCRIPTION,
            createdAt: at(tourTime(12000)),
            ...(elapsed >= tourTime(13000) ? { generatedAt: at(tourTime(13000)) } : {}),
            milestoneIds: commitments.map((item) => item.id),
            assignments: commitments.map((item) => ({
              commitmentId: item.id,
              employeeId: item.ownerId,
              status: 'assigned' as const,
            })),
          },
        }
      : {}),
    messages: [
      ...(elapsed >= tourTime(11800)
        ? [
            {
              id: 'demo-message-goal',
              authorId: 'you',
              channel: 'announce',
              text: `${TOUR_GOAL}\n${TOUR_GOAL_DESCRIPTION}`,
              time: at(tourTime(11800)),
              acknowledgmentIds: employees.map((employee) => employee.id),
            },
          ]
        : []),
      ...productLaunchChatAt(elapsed),
    ].sort((left, right) => left.time.localeCompare(right.time)),
    events: eventFixtures
      .filter((event) => elapsed >= event.ms)
      .map((event) => ({
        id: `demo-event-${event.ms}`,
        ...(event.employeeId ? { employeeId: event.employeeId } : {}),
        text: event.text,
        time: at(event.ms),
        kind: event.kind,
        source: 'example',
      })),
  };
}

/** Explicit user download only. This never opens a real workspace or invokes Electron's API. */
export function downloadProductLaunchFile(id: TourArtifactId): void {
  const file = productLaunchFile(id);
  const anchor = document.createElement('a');
  let objectUrl: string | undefined;
  if (file.assetUrl) anchor.href = file.assetUrl;
  else {
    objectUrl = URL.createObjectURL(
      new Blob([file.downloadContent ?? file.content], { type: file.mediaType }),
    );
    anchor.href = objectUrl;
  }
  anchor.download = file.downloadName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if (objectUrl) {
    // The click starts the browser download synchronously; release the URL after the current task.
    const revoke = objectUrl;
    queueMicrotask(() => URL.revokeObjectURL(revoke));
  }
}
