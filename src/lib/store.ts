import { StateSchema } from '../../shared/schemas';
import type { AppState, Employee, WorkspaceFolder } from '../../shared/types';
export const STORAGE_KEY = 'astra-hq:v1';
export const uid = () => crypto.randomUUID();
export const timeNow = () => new Date().toISOString();
export const employeeColors = ['#c49871', '#667e6b', '#718da1', '#c8a465', '#a0889b', '#82958a'];
const at = (hour: number, minute: number) => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};
const deadline = (days: number, hour = 17) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};
export function initialState(): AppState {
  return {
    schemaVersion: 1,
    workspaceName: 'My headquarters',
    goal: 'Give your team a goal to work toward.',
    reducedMotion: false,
    sound: false,
    demo: false,
    employees: [],
    commitments: [],
    messages: [],
    approvals: [],
    events: [],
    folders: [],
  };
}

// Example data is available only when explicitly selected in Settings.
export function sampleState(): AppState {
  return {
    schemaVersion: 1,
    workspaceName: 'My headquarters',
    goal: 'Make room for the big picture. Keep every client promise.',
    reducedMotion: false,
    sound: false,
    demo: true,
    employees: [
      {
        id: 'maya',
        name: 'Maya',
        jobTitle: 'Research Lead',
        personality: 'Curious, thoughtful, and meticulous. Makes complex things feel simple.',
        skills: 'Research, source verification, supplier comparison, concise briefs',
        color: employeeColors[0],
        avatar: 0,
        status: 'review',
        activity: 'Supplier shortlist is ready',
        location: 'desk',
      },
      {
        id: 'leo',
        name: 'Leo',
        jobTitle: 'Software Engineer',
        personality: 'Practical, inventive, and quietly optimistic.',
        skills: 'Frontend development, data visualization, testing, documentation',
        color: employeeColors[1],
        avatar: 1,
        status: 'ready',
        activity: 'Dashboard implementation',
        location: 'desk',
      },
      {
        id: 'nora',
        name: 'Nora',
        jobTitle: 'Operations Manager',
        personality: 'Calm under pressure. Organized, resourceful, and proactive.',
        skills: 'Project coordination, process improvement, vendor management',
        color: employeeColors[2],
        avatar: 2,
        status: 'ready',
        activity: 'Checking supplier lead times',
        location: 'library',
      },
      {
        id: 'sam',
        name: 'Sam',
        jobTitle: 'Finance Analyst',
        personality: 'Analytical and approachable. Clear about assumptions.',
        skills: 'Financial modeling, forecasts, spreadsheet analysis, reporting',
        color: employeeColors[3],
        avatar: 3,
        status: 'review',
        activity: 'Q3 forecast is ready for review',
        location: 'desk',
      },
      {
        id: 'jules',
        name: 'Jules',
        jobTitle: 'Creative Strategist',
        personality: 'Warm, imaginative, and attentive to the details.',
        skills: 'Brand strategy, storytelling, creative direction, copywriting',
        color: employeeColors[4],
        avatar: 4,
        status: 'ready',
        activity: 'Planning the next chapter',
        location: 'board',
      },
      {
        id: 'oliver',
        name: 'Oliver',
        jobTitle: 'Project Coordinator',
        personality: 'Friendly, reliable, and good at seeing the whole picture.',
        skills: 'Task planning, handoffs, client updates, deadline tracking',
        color: employeeColors[5],
        avatar: 5,
        status: 'ready',
        activity: 'Bringing the weekly update together',
        location: 'meeting',
      },
    ],
    commitments: [
      {
        id: 'supplier',
        title: 'Find the right production partner',
        description:
          'Compare sustainable packaging suppliers and prepare a recommendation for the new collection.',
        ownerId: 'maya',
        recipient: 'Northstar team',
        deadline: deadline(1),
        firm: true,
        status: 'review',
        progress: 85,
        nextStep: 'Review Maya’s supplier shortlist',
        dependencies: [],
        source: 'Example assignment',
        definitionOfDone:
          'Three suppliers compared on cost, lead time, and sustainability, with a reviewed recommendation.',
      },
      {
        id: 'forecast',
        title: 'Bring clarity to the Q3 forecast',
        description: 'Review the working forecast and identify the assumptions that need a second look.',
        ownerId: 'sam',
        recipient: 'Leadership team',
        deadline: deadline(2),
        firm: false,
        status: 'review',
        progress: 90,
        nextStep: 'Review the forecast assumptions',
        dependencies: [],
        source: 'Example assignment',
        definitionOfDone: 'A reviewed forecast with explicit assumptions and a clear variance summary.',
      },
      {
        id: 'update',
        title: 'A thoughtful weekly client update',
        description:
          'Collect this week’s progress, upcoming milestones, and open questions into one client-ready draft.',
        ownerId: 'oliver',
        recipient: 'Northstar client',
        deadline: deadline(1, 16),
        firm: true,
        status: 'planned',
        progress: 35,
        nextStep: 'Confirm the supplier recommendation',
        dependencies: ['supplier'],
        source: 'Example assignment',
        definitionOfDone: 'A client-ready draft covering progress, milestones, and any decisions needed.',
      },
    ],
    messages: [
      {
        id: 'm1',
        authorId: 'you',
        channel: 'announce',
        text: 'Let’s make this a good week. Focus on the Northstar launch, and bring anything that needs a decision back to me.',
        time: at(9, 0),
        acknowledgmentIds: ['maya', 'leo', 'nora', 'sam', 'jules', 'oliver'],
      },
      {
        id: 'm2',
        authorId: 'maya',
        channel: 'team',
        text: 'The supplier comparison is ready. Three strong options, with a clear front-runner.',
        time: at(10, 14),
      },
      {
        id: 'm3',
        authorId: 'nora',
        channel: 'team',
        text: 'Thanks, Maya. I’ll check the lead times so we have the full picture.',
        time: at(10, 16),
      },
      {
        id: 'm4',
        authorId: 'sam',
        channel: 'team',
        text: 'The forecast is ready for a second pair of eyes. I’ve called out the assumptions.',
        time: at(10, 18),
      },
      {
        id: 'm5',
        authorId: 'oliver',
        channel: 'team',
        text: 'I’ll bring everything into the weekly update once the shortlist is approved.',
        time: at(10, 21),
      },
    ],
    approvals: [
      {
        id: 'a1',
        employeeId: 'maya',
        title: 'A shortlist worth a look',
        summary: 'Three suppliers. One recommendation. Ready for your call.',
        content:
          '# Sustainable packaging · supplier shortlist\n\nThis is an example deliverable to explore the review workflow. Supplier names and figures are illustrative.\n\n## The recommendation\n\n**Evergreen Packaging** offers the best balance of recycled materials, a manageable minimum order, and a four-week lead time.\n\n| Supplier | Estimated unit cost | Lead time | Recycled content |\n| --- | --- | --- | --- |\n| Evergreen Packaging | $1.80 | 4 weeks | 100% |\n| Form & Field | $2.10 | 3 weeks | 85% |\n| Paperwork Co. | $1.65 | 6 weeks | 90% |\n\n## Before we commit\n\n- Request a physical sample and confirm final pricing.\n- Verify the material certifications directly.\n- Nora will validate capacity against the launch date.\n\n## Your decision\n\nApprove this recommendation for the team’s planning, or request changes. Approval here does not contact a supplier or place an order.',
        createdAt: at(10, 12),
        status: 'pending',
        commitmentId: 'supplier',
        kind: 'decision',
        recipient: 'Internal team · no external delivery',
        sources: ['Example supplier comparison', 'Example launch requirements'],
        version: 1,
      },
      {
        id: 'a2',
        employeeId: 'sam',
        title: 'The bigger financial picture',
        summary: 'Q3 forecast, with the assumptions brought into focus.',
        content:
          '# Q3 forecast · review draft\n\nThis is an example forecast for exploring the approval experience. These are illustrative figures, not business data.\n\n## Working outlook\n\n- Revenue: **$128,000**\n- Operating costs: **$84,000**\n- Working margin: **34.4%**\n\n## Assumptions to confirm\n\n1. The Northstar launch stays within the current quarter.\n2. Production costs remain within the supplier estimate.\n3. Two client renewals close on their expected dates.\n\n## Next step\n\nReview these assumptions before the team uses this draft for planning. No financial transaction is authorized by this review.',
        createdAt: at(10, 3),
        status: 'pending',
        commitmentId: 'forecast',
        kind: 'document',
        recipient: 'Internal planning · no external delivery',
        sources: ['Example revenue plan', 'Example operating budget'],
        version: 1,
      },
    ],
    events: [
      {
        id: 'e1',
        text: 'The day began with a shared direction',
        time: at(9, 0),
        kind: 'announcement',
        source: 'example',
      },
      {
        id: 'e2',
        employeeId: 'maya',
        text: 'Supplier research brought into a shortlist',
        time: at(9, 45),
        kind: 'work',
        source: 'example',
      },
      {
        id: 'e3',
        employeeId: 'sam',
        text: 'Q3 forecast prepared for review',
        time: at(10, 3),
        kind: 'review',
        source: 'example',
      },
      {
        id: 'e4',
        employeeId: 'maya',
        text: 'Supplier shortlist is ready for your decision',
        time: at(10, 12),
        kind: 'review',
        source: 'example',
      },
    ],
    folders: [],
  };
}
export function isState(value: unknown): value is AppState {
  return StateSchema.safeParse(value).success;
}
export function readLocalState(): AppState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (isState(value)) return value;
  } catch {
    /* Recover a fresh workspace if local cache is damaged. */
  }
  return initialState();
}
export function profileSuggestion(title: string) {
  const role = title.toLowerCase();
  if (/research|analyst/.test(role))
    return {
      personality: 'Curious, methodical, and clear. Verifies sources and makes uncertainty explicit.',
      skills: 'Research, source verification, comparative analysis, concise reports',
    };
  if (/engineer|developer/.test(role))
    return {
      personality: 'Practical, thoughtful, and detail-oriented. Explains tradeoffs and tests the work.',
      skills: 'Software development, debugging, testing, technical documentation',
    };
  if (/design|creative|market/.test(role))
    return {
      personality: 'Imaginative, empathetic, and attentive to detail. Connects good ideas to clear outcomes.',
      skills: 'Creative strategy, audience research, writing, concept development',
    };
  return {
    personality:
      'Calm, proactive, and concise. Keeps promises visible and asks when requirements are unclear.',
    skills: 'Project coordination, document summaries, planning, clear communication',
  };
}
export function folderBrief(folder: WorkspaceFolder): string {
  return `# ${folder.name} · workspace brief\n\nPrepared locally from your selected folder on ${new Date(folder.createdAt).toLocaleDateString()}. This is a source inventory, not an AI-generated analysis. No files have been uploaded.\n\n## At a glance\n\n- ${folder.files.length} supported files in an isolated copy\n- ${folder.excludedCount} excluded entries (unsupported, hidden, secret-like, oversized, or symbolic links)\n\n## Source material\n\n${folder.files.map((f) => `### ${f.path}\n\n${f.size.toLocaleString()} bytes\n\n${f.excerpt || '(No readable text excerpt)'}`).join('\n\n')}\n\n## Questions for the weekly update\n\n- What changed this week?\n- Which milestones come next?\n- Which figures or commitments still need confirmation?\n- What decision does the client need to make?\n\n## Suggested next step\n\nConnect Astra cloud and assign an employee to turn these source files into a reviewed client update. Explicitly authorize sharing this folder when starting the assignment.\n`;
}
export function employeeById(employees: Employee[], id?: string) {
  return employees.find((e) => e.id === id);
}
export function clockTime(time: string) {
  return new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function dueLabel(time: string) {
  const day = new Date(time);
  const today = new Date();
  const delta = Math.round(
    (new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86400000,
  );
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  return day.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
