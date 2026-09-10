import { z } from 'zod';
export const AppearanceSchema = z.object({
  gender: z.enum(['neutral', 'feminine', 'masculine']),
  skin: z.string().regex(/^#[0-9a-f]{6}$/i),
  hair: z.string().regex(/^#[0-9a-f]{6}$/i),
  hairstyle: z.enum(['short', 'long', 'bald']),
  hat: z.enum(['none', 'cap', 'beanie']),
  glasses: z.boolean(),
  clothing: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export const EmployeeSchema = z.object({
  temporary: z.boolean().optional(),
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(40),
  jobTitle: z.string().min(1).max(80),
  personality: z.string().max(2000),
  skills: z
    .string()
    .max(2200)
    .transform((value) =>
      [
        'Astra session',
        ...value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && !['astra cloud session', 'astra session'].includes(s.toLowerCase())),
      ].join(', '),
    ),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  appearance: AppearanceSchema.optional(),
  avatar: z.number().int().min(0).max(1000),
  status: z.enum(['working', 'review', 'ready', 'offline']),
  activity: z.string().max(2000),
  location: z.enum(['desk', 'library', 'meeting', 'board']),
  sessionId: z.string().max(200).optional(),
});
const dateTime = z.string().datetime();
export const FolderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  createdAt: dateTime,
  excludedCount: z.number().int().min(0),
  files: z
    .array(
      z.object({
        path: z.string().max(2000),
        size: z.number().int().min(0).max(512000),
        excerpt: z.string().max(1500),
      }),
    )
    .max(100),
});
export const StateSchema = z.object({
  launchRestoreId: z.string().optional(),
  schemaVersion: z.literal(1),
  workspaceName: z.string().min(1).max(40),
  goal: z.string().min(1).max(500),
  roadmap: z
    .object({
      id: z.string().uuid(),
      goal: z.string().min(1).max(500),
      status: z.enum(['planning', 'active', 'paused', 'failed', 'complete']),
      automatic: z.boolean().optional(),
      folderIds: z.array(z.string().uuid()).max(10).optional(),
      launchId: z.string().optional(),
      message: z.string().max(4000),
      createdAt: dateTime,
      generatedAt: dateTime.optional(),
      milestoneIds: z.array(z.string().max(100)).max(1000),
      assignments: z
        .array(
          z.object({
            commitmentId: z.string().max(100),
            employeeId: z.string().max(100),
            sessionId: z.string().max(200).optional(),
            status: z.enum(['starting', 'assigned', 'stopped']),
          }),
        )
        .max(1000),
    })
    .optional(),
  employees: z.array(EmployeeSchema).max(50),
  commitments: z
    .array(
      z.object({
        id: z.string().max(100),
        title: z.string().min(1).max(120),
        description: z.string().max(2000),
        sessionId: z.string().max(200).optional(),
        assignment: z.string().max(12000).optional(),
        taskKind: z.enum(['report', 'meeting', 'bug', 'qa', 'product']).optional(),
        launchId: z.string().optional(),
        launchStep: z.enum(['product', 'marketing', 'forecast', 'revision', 'bug', 'reporter']).optional(),
        ownerId: z.string().max(100),
        recipient: z.string().max(120),
        deadline: dateTime.or(z.literal('')),
        firm: z.boolean(),
        status: z.enum(['in-progress', 'review', 'done', 'planned']),
        progress: z.number().min(0).max(100),
        nextStep: z.string().max(4000),
        dependencies: z.array(z.string()).max(100),
        source: z.string().max(200),
        definitionOfDone: z.string().max(1000),
      }),
    )
    .max(1000),
  messages: z
    .array(
      z.object({
        id: z.string().max(200),
        authorId: z.string().max(100),
        channel: z.string().max(100),
        text: z.string().max(12000),
        time: dateTime,
        acknowledgmentIds: z.array(z.string()).max(50).optional(),
      }),
    )
    .max(10000),
  approvals: z
    .array(
      z.object({
        id: z.string().max(200),
        employeeId: z.string().max(100),
        title: z.string().max(255),
        summary: z.string().max(2000),
        question: z.string().max(300).optional(),
        choices: z.array(z.string().min(1).max(160)).min(2).max(6).optional(),
        content: z.string().max(300000),
        createdAt: dateTime,
        status: z.enum(['pending', 'approved', 'changes-requested']),
        commitmentId: z.string().max(100).optional(),
        kind: z.enum(['document', 'decision']),
        recipient: z.string().max(500),
        sources: z.array(z.string().max(2000)).max(100),
        version: z.number().int().min(1),
        sessionId: z.string().max(200).optional(),
      }),
    )
    .max(1000),
  events: z
    .array(
      z.object({
        id: z.string().max(500),
        employeeId: z.string().max(100).optional(),
        text: z.string().max(12000),
        time: dateTime,
        kind: z.enum(['work', 'review', 'announcement', 'system']),
        source: z.enum(['example', 'local', 'cloud', 'chatgpt']),
      }),
    )
    .max(20000),
  folders: z.array(FolderSchema).max(100),
  reducedMotion: z.boolean(),
  sound: z.boolean(),
  demo: z.boolean(),
});
export const SessionSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(['queued', 'running', 'waiting_for_approval', 'completed', 'failed']),
  activity: z.string().max(2000),
  location: z.enum(['desk', 'library', 'meeting', 'board']),
  events: z
    .array(z.object({ id: z.string().max(200), text: z.string().max(12000), time: dateTime }))
    .max(500),
  output: z
    .object({
      title: z.string().max(255),
      content: z.string().max(200000),
      question: z.string().max(300).optional(),
      choices: z.array(z.string().min(1).max(160)).min(2).max(6).optional(),
      sources: z.array(z.string().max(2000)).max(100),
      recipient: z.string().max(500),
      version: z.number().int().min(1),
    })
    .optional(),
});
