import { notFound } from 'next/navigation';
import { OfficeLab } from './lab';

/**
 * A deterministic office render for visual baselines. Exists only when QA_FIXTURE=1; every other
 * build answers 404. Query parameters choose the scene: `preset`, `hour`, `labels`, `seed`, and
 * `at` — the hour of the day the replay's scrubber is standing on.
 */
export default async function OfficeLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.QA_FIXTURE !== '1') notFound();
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return (
    <OfficeLab
      preset={single('preset') ?? 'floor-day'}
      hour={Number(single('hour') ?? 13)}
      labels={single('labels') ?? 'names'}
      seed={Number(single('seed') ?? 1)}
      at={Number(single('at') ?? 10)}
    />
  );
}
