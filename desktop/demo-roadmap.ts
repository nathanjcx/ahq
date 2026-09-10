import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AppState, CloudSession } from '../shared/types';
import type { LocalTaskInput } from '../shared/demo';
import { demoDataPath } from './demo-execution';

export async function validateLocalArtifacts(session: CloudSession): Promise<boolean> {
  if (!session.workspace || !session.artifacts?.length || session.output?.choices?.length) return false;
  try {
    const root = `${await realpath(session.workspace)}${path.sep}`;
    for (const artifact of session.artifacts) {
      const file = await realpath(artifact.filePath);
      const info = await stat(file);
      if (!file.startsWith(root) || !info.isFile() || !info.size || !artifact.content.trim()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function roadmapTask(
  state: AppState,
  employeeId: string,
  getSession: (id: string) => Promise<CloudSession>,
): Promise<LocalTaskInput> {
  const claim = state.roadmap?.assignments.find(
    (item) => item.employeeId === employeeId && item.status === 'starting',
  );
  const task = state.commitments.find((item) => item.id === claim?.commitmentId);
  if (!task?.taskKind) throw new Error('This automatic roadmap step has no supported execution type.');
  const files = await Promise.all(
    ['sales', 'campaigns', 'support'].map(async (name) => ({
      name: `${name}.csv`,
      mediaType: 'text/csv',
      content: await readFile(path.join(demoDataPath, 'custom-arrival', `${name}.csv`), 'utf8'),
    })),
  );
  let parent: CloudSession | undefined;
  for (const id of task.dependencies) {
    const dependency = state.commitments.find((item) => item.id === id);
    const sessionId =
      state.roadmap?.assignments.find((item) => item.commitmentId === id)?.sessionId || dependency?.sessionId;
    if (!sessionId) throw new Error('A prerequisite has no saved execution session.');
    const session = await getSession(sessionId);
    if (session.status !== 'completed' || !session.reviewed || !(await validateLocalArtifacts(session)))
      throw new Error('A prerequisite has no verified completed artifacts.');
    for (const artifact of session.artifacts!)
      files.push({
        name: `prerequisite-${session.id}-${artifact.id}.md`,
        mediaType: 'text/markdown',
        content: `# ${artifact.title}\n\nSession: ${session.id}\nArtifact: ${artifact.id}\nSimulated publication: ${artifact.simulated}\n\n${artifact.content}`,
      });
    if (dependency?.taskKind === 'bug') parent = session;
  }
  if (task.taskKind === 'qa' && !parent?.workspace)
    throw new Error('QA requires its completed code-change workspace.');
  return {
    kind: task.taskKind,
    title: task.title,
    files,
    ...(parent ? { parentWorkspace: parent.workspace, parentSessionId: parent.id } : {}),
  };
}
