import type { WorkEvent } from './types';
export function activityExport(events: WorkEvent[], format: 'json' | 'csv'): string {
  if (format === 'json') return JSON.stringify(events, null, 2);
  const quote = (value: string) => {
    const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      ['Time', 'Employee', 'Source', 'Kind', 'Activity'],
      ...events.map((e) => [e.time, e.employeeId ?? 'You', e.source, e.kind, e.text]),
    ]
      .map((row) => row.map(quote).join(','))
      .join('\r\n')
  );
}
