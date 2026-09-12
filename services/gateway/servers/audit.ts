import type { Severity } from '../../../lib/contracts';
import { getArtifact } from '../../../lib/server/storage';
import { GatewayError } from '../errors';
import { boundedNumber, optionalString, requireString, untrusted, type InternalTool } from './shared';

/** How much of an archived file the code reader returns. Beyond this the auditor asks for a slice. */
const ARTIFACT_BYTE_CAP = 200_000;
const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(args: Record<string, unknown>, field = 'date') {
  const date = requireString(args, field);
  if (!DATE.test(date)) throw new GatewayError('invalid_arguments', `${field} must be YYYY-MM-DD.`);
  return date;
}

const readReports: InternalTool = {
  name: 'read_reports',
  description:
    'The night you are auditing: every shift of that working day with its report, its tool calls, its artifacts, the workspace standard, and yesterday’s findings that are still open.',
  properties: { date: { type: 'string', description: 'The working day, as YYYY-MM-DD.' } },
  required: ['date'],
  async run(request, context, args) {
    const inputs = await request.backend.query<Record<string, unknown>>('services/audit:auditInputs', {
      runToken: request.runToken,
      workspaceId: context.task.workspaceId,
      date: requireDate(args),
    });
    // The standard is the administrator's own words, so it stays instruction; the work is claims.
    const { standards, ...material } = inputs;
    return { standards, work: untrusted(material) };
  },
};

const readJournal: InternalTool = {
  name: 'read_journal',
  description:
    'One task’s journal: its events, the employee’s own messages, and every tool call with its outcome. This is the record a report is checked against.',
  properties: { taskId: { type: 'string', description: 'The task to read.' } },
  required: ['taskId'],
  async run(request, _context, args) {
    const journal = await request.backend.query<Record<string, unknown>>('services/audit:readJournal', {
      runToken: request.runToken,
      taskId: requireString(args, 'taskId'),
    });
    return { journal: untrusted(journal) };
  },
};

const readArtifact: InternalTool = {
  name: 'read_artifact',
  description:
    'Read an archived deliverable as text. Large files come back truncated with their true size, so ask for what you need rather than the whole archive.',
  properties: { artifactId: { type: 'string', description: 'The artifact to read.' } },
  required: ['artifactId'],
  async run(request, _context, args) {
    const artifact = await request.backend.query<{
      name: string;
      mediaType: string;
      size: number;
      storageKey: string;
    }>('services/artifacts:artifactForRun', {
      runToken: request.runToken,
      artifactId: requireString(args, 'artifactId'),
    });
    const response = await getArtifact(artifact.storageKey);
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new GatewayError('provider_error', 'The archived file could not be read.');
    const truncated = bytes.byteLength > ARTIFACT_BYTE_CAP;
    const text = Buffer.from(bytes.subarray(0, ARTIFACT_BYTE_CAP)).toString('utf8');
    return {
      name: artifact.name,
      mediaType: artifact.mediaType,
      size: artifact.size,
      truncated,
      content: untrusted(text),
    };
  },
};

const readMemory: InternalTool = {
  name: 'read_memory',
  description: 'Search this workspace’s memory by tag and keyword, to check a claim against it.',
  properties: { query: { type: 'string', description: 'Words or tags to search for.' } },
  required: ['query'],
  async run(request, _context, args) {
    const rows = await request.backend.query<unknown[]>('services/memory:recall', {
      runToken: request.runToken,
      query: requireString(args, 'query'),
    });
    return { count: rows.length, memories: untrusted(rows) };
  },
};

const readChannel: InternalTool = {
  name: 'read_channel',
  description: 'Read the recent posts on the channels this audit run can see.',
  properties: { limit: { type: 'number', description: 'Posts per channel, up to 50.' } },
  async run(request, _context, args) {
    const limit = boundedNumber(args, 'limit', 1, 50);
    const rows = await request.backend.query<unknown[]>('services/channels:readBoard', {
      runToken: request.runToken,
      ...(limit === undefined ? {} : { limit: Math.floor(limit) }),
    });
    return { channels: untrusted(rows) };
  },
};

interface FindingInput {
  employeeId: string;
  taskId?: string;
  severity: Severity;
  claim: string;
  evidence: string;
  requiredAction: string;
}

function parseFindings(value: unknown): FindingInput[] {
  if (!Array.isArray(value)) throw new GatewayError('invalid_arguments', 'findings must be an array.');
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new GatewayError('invalid_arguments', 'Each finding must be an object.');
    const finding = row as Record<string, unknown>;
    const severity = requireString(finding, 'severity');
    if (!SEVERITIES.includes(severity as Severity))
      throw new GatewayError('invalid_arguments', `severity must be one of ${SEVERITIES.join(', ')}.`);
    const taskId = optionalString(finding, 'taskId');
    return {
      employeeId: requireString(finding, 'employeeId'),
      ...(taskId ? { taskId } : {}),
      severity: severity as Severity,
      claim: requireString(finding, 'claim'),
      evidence: requireString(finding, 'evidence'),
      requiredAction: requireString(finding, 'requiredAction'),
    };
  });
}

/**
 * The one write an audit run makes: its own findings. Recording them also re-verifies yesterday's,
 * because whether a finding was addressed is decided by the same record this run just read.
 */
const submitFindings: InternalTool = {
  name: 'submit_findings',
  description:
    'File the night’s findings, one per claim, each with the evidence from the journal and the action it requires. Filing also re-checks yesterday’s findings against today’s record.',
  properties: {
    date: { type: 'string', description: 'The working day audited, as YYYY-MM-DD.' },
    findings: {
      type: 'array',
      description: 'Each with employeeId, optional taskId, severity, claim, evidence, requiredAction.',
      items: { type: 'object' },
    },
  },
  required: ['date', 'findings'],
  async run(request, context, args) {
    const date = requireDate(args);
    const base = { runToken: request.runToken, workspaceId: context.task.workspaceId, date };
    const documents = await request.backend.mutate<{ employeeId: string }[]>(
      'services/audit:recordFindings',
      { ...base, findings: parseFindings(args.findings) },
    );
    const { verified } = await request.backend.mutate<{ verified: number }>(
      'services/audit:verifyFindings',
      base,
    );
    return { documents: documents.length, verified };
  },
};

export const auditTools = [readReports, readJournal, readArtifact, readMemory, readChannel, submitFindings];
