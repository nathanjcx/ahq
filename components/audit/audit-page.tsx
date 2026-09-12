'use client';

import type { PageProps } from '../app/page-props';
import { PageIntro } from '../shared/page-intro';

export function AuditPage(_props: PageProps) {
  return <PageIntro title="Audit" description="Filled by the audit workstream." />;
}
