export type Employee = {
  id: string;
  name: string;
  role: string;
  personality: string;
  skills: string;
  color: string;
  initials: string;
  task: string;
  status: "working" | "review" | "ready";
  position: [number, number, number];
};
export type WorkEvent = {
  id: string;
  person: string;
  action: string;
  detail: string;
  time: string;
  kind: "work" | "handoff" | "review" | "announcement";
};
export type Commitment = {
  id: string;
  title: string;
  description: string;
  due: string;
  owner: string;
  status: "In progress" | "Needs review" | "Completed";
  progress: number;
  steps: string[];
};
export type Chat = {
  id: string;
  person: string;
  text: string;
  channel: string;
  time: string;
};
export type View =
  | "Office"
  | "Employees"
  | "Announce"
  | "Commitments"
  | "Conversations"
  | "Needs you"
  | "Resources";
export const employees: Employee[] = [
  {
    id: "maya",
    name: "Maya",
    role: "Chief of Staff",
    personality:
      "Thoughtful, decisive, and always two steps ahead. Keeps the team focused without getting in the way.",
    skills: "Project planning, Team coordination, Client communication",
    color: "#bd765c",
    initials: "MY",
    task: "Putting the launch brief together",
    status: "review",
    position: [-1.8, 0, 2.5],
  },
  {
    id: "leo",
    name: "Leo",
    role: "Research Analyst",
    personality:
      "Insatiably curious. Finds the overlooked detail and backs every recommendation with a source.",
    skills: "Market research, Source verification, Competitive analysis",
    color: "#6c88a3",
    initials: "LE",
    task: "Mapping the competitive landscape",
    status: "working",
    position: [-5.8, 0, -1.2],
  },
  {
    id: "iris",
    name: "Iris",
    role: "Creative Strategist",
    personality:
      "A visual thinker with bold taste. Connects unexpected ideas and makes complex stories feel simple.",
    skills: "Brand strategy, Creative direction, Storytelling",
    color: "#9a83a4",
    initials: "IR",
    task: "Discussing the launch narrative",
    status: "working",
    position: [4.5, 0, -2.8],
  },
  {
    id: "noah",
    name: "Noah",
    role: "Operations Lead",
    personality:
      "Calm under pressure. Loves a good system and never lets an important promise slip.",
    skills: "Workflow design, Deadline tracking, Resource planning",
    color: "#799786",
    initials: "NO",
    task: "Checking launch dependencies",
    status: "working",
    position: [-5.8, 0, 2.8],
  },
];
export const initialEvents: WorkEvent[] = [
  {
    id: "e1",
    person: "maya",
    action: "The launch brief is ready for you",
    detail: "One decision will unblock the team.",
    time: "Just now",
    kind: "review",
  },
  {
    id: "e2",
    person: "leo",
    action: "Shared research with Iris",
    detail: "Three useful gaps in the market.",
    time: "2m ago",
    kind: "handoff",
  },
  {
    id: "e3",
    person: "iris",
    action: "Started the creative direction",
    detail: "Turning research into a story.",
    time: "4m ago",
    kind: "work",
  },
  {
    id: "e4",
    person: "noah",
    action: "Mapped the launch dependencies",
    detail: "Everything has an owner.",
    time: "7m ago",
    kind: "work",
  },
];
export const initialCommitments: Commitment[] = [
  {
    id: "launch",
    title: "Make the Northstar launch a great one",
    description:
      "A clear story, a researched audience, and a plan everyone can work from.",
    due: "Tomorrow, 4:00 PM",
    owner: "maya",
    status: "Needs review",
    progress: 50,
    steps: [
      "Research the landscape",
      "Shape the narrative",
      "Review the launch brief",
      "Prepare the final handoff",
    ],
  },
  {
    id: "weekly",
    title: "Keep the client in the loop",
    description:
      "Prepare a thoughtful weekly update with the progress that matters.",
    due: "Friday, 12:00 PM",
    owner: "noah",
    status: "In progress",
    progress: 25,
    steps: [
      "Gather project updates",
      "Verify milestones",
      "Draft the client email",
      "Review before delivery",
    ],
  },
  {
    id: "research",
    title: "Find our next opportunity",
    description: "Three promising market opportunities, backed by sources.",
    due: "Monday, 10:00 AM",
    owner: "leo",
    status: "In progress",
    progress: 50,
    steps: [
      "Scan the market",
      "Compare alternatives",
      "Identify unmet needs",
      "Prepare recommendations",
    ],
  },
];
export const initialChat: Chat[] = [
  {
    id: "c1",
    person: "leo",
    text: "I found three gaps in the market. The strongest: teams want a clearer next step, without another planning ritual. I’ve put the findings in the research notes.",
    channel: "team",
    time: "10:38 AM",
  },
  {
    id: "c2",
    person: "iris",
    text: "That gives us a good starting point. I’m exploring “Less managing. More making.” as the launch direction.",
    channel: "team",
    time: "10:40 AM",
  },
  {
    id: "c3",
    person: "maya",
    text: "I’ve brought the research and story into one launch brief. Pablo, it’s ready whenever you have a moment.",
    channel: "team",
    time: "10:42 AM",
  },
];
export const launchDraft = `OUR OPPORTUNITY\nSmall teams are spending more time coordinating work than doing it. Northstar makes the next useful step clear while keeping the bigger promise in view.\n\nTHE AUDIENCE\nIndependent operators and teams of 2–10 who manage several client commitments at once.\n\nTHE STORY\nLess managing. More making. Lead with the moment a scattered week becomes a clear path forward.\n\nTHE LAUNCH PLAN\n1. Introduce the problem with a 45-second product walkthrough.\n2. Invite 20 design partners for a guided first project.\n3. Share three concrete before-and-after workflows.\n\nDECISION NEEDED\nApprove a product-led launch direction. Noah will prepare the final handoff; Iris will develop creative concepts.\n\nPrepared by Maya, with research from Leo and creative direction from Iris.\nDemo content — replace with your real project materials.`;
