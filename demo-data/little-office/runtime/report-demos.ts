import { readFileSync } from 'node:fs';
import path from 'node:path';
import { demoDataDirectory } from './evidence';
import type { SourceItem } from '../src/shared/types';

export function reportDemos(now: number): Array<{ id: string; label: string; item: SourceItem }> {
  return [
    { name: 'sales', source: 'gmail' as const, author: 'Alex Morgan', title: 'Create a PDF sales report from this CSV',
      content: 'Please create a short PDF sales report using only the attached sales.csv. Calculate monthly revenue, costs, gross profit and gross margin for July, August and September, compare products, and recommend two next steps. Units times unit price gives revenue; units times unit cost gives cost. All amounts are USD. These six rows are the complete dataset. This is a new standalone report, unrelated to the launch reports.' },
    { name: 'campaigns', source: 'gmail' as const, author: 'Jordan Lee', title: 'Create a PDF comparing our marketing campaigns',
      content: 'Please create a short PDF marketing report using only campaigns.csv. Compare cost per signup, customer acquisition cost, revenue divided by spend, and profit after advertising spend for each campaign. Recommend how to allocate the next $1,000, with reasons. All amounts are USD; this is the complete campaign dataset. This is a separate report from sales and launch work.' },
    { name: 'support', source: 'slack' as const, author: 'Sam Rivera', title: 'Create a PDF support performance report',
      content: 'Please turn the attached support.csv into a short PDF support report. Compare total tickets, resolved tickets and resolution rate between weeks 1 and 2. Show category changes and the response-time improvement for each category. Do not average category medians into an overall median. Recommend two actions for next week. These six rows are the complete dataset. This report is separate from sales, campaigns, and Pinecone support.' },
  ].map((demo, index) => ({
    id: `arrival-pdf-${demo.name}`, label: `[ACTION: CREATE PDF REPORT] ${demo.title}`,
    item: { id: `source-pdf-${demo.name}`, source: demo.source, externalId: `pdf-${demo.name}`, threadId: `pdf-${demo.name}`,
      author: demo.author, title: demo.title, content: demo.content, timestamp: now + index * 1000,
      ...(demo.source === 'slack' ? { channel: '#support-ops' } : {}),
      attachments: [{ id: `csv-${demo.name}`, name: `${demo.name}.csv`, mediaType: 'text/csv',
        content: readFileSync(path.join(demoDataDirectory, 'custom-arrival', `${demo.name}.csv`), 'utf8') }],
    },
  }));
}
