'use client';

import type { PageProps } from '../app/page-props';
import { PageIntro } from '../shared/page-intro';

export function TriagePage(_props: PageProps) {
  return <PageIntro title="Triage" description="Filled by the triage workstream." />;
}
