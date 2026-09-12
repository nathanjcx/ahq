import { notFound } from 'next/navigation';
import { QaWorkspace } from './qa-shell';

/**
 * A photographable workspace for visual review. It exists only when QA_FIXTURE=1 is set for the dev
 * or build environment; every other build answers 404, so nothing ships a fake workspace.
 */
export default function QaPage() {
  if (process.env.QA_FIXTURE !== '1') notFound();
  return <QaWorkspace />;
}
