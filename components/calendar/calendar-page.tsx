'use client';

import type { PageProps } from '../app/page-props';
import { PageIntro } from '../shared/page-intro';

export function CalendarPage(_props: PageProps) {
  return <PageIntro title="Calendar" description="Filled by the calendar workstream." />;
}
