'use client';

import { useMemo } from 'react';
import type { Activity, EmployeeActivity } from '@/components/office/activity';
import type { LabelMode } from '@/components/office/office-labels';
import type { OfficeEmployee, OfficeProvider } from '@/components/office/office-scene';
import { OfficeStage, type OfficeSceneData } from '@/components/office/office-stage';

/**
 * Presets are the scenes the baselines photograph. Each is fully determined by its name, the hour,
 * and the seed, so the same query renders the same frame. Add a preset here and a baseline test in
 * web-tests/lab for every new room or state the scene learns.
 */
const PEOPLE: { name: string; role: string; color: string; traits: string[] }[] = [
  { name: 'Ada', role: 'Operations analyst', color: '#6864d9', traits: ['fast', 'dry humour'] },
  { name: 'Bruno', role: 'Release writer', color: '#b06a3b', traits: ['methodical'] },
  { name: 'Cyrus', role: 'Data engineer', color: '#3b6fb0', traits: ['cautious'] },
  { name: 'Emi', role: 'Product designer', color: '#b03b7a', traits: ['playful'] },
  { name: 'Fen', role: 'Quality lead', color: '#4f8a4b', traits: ['terse'] },
  { name: 'Gil', role: 'Finance analyst', color: '#8a7a2b', traits: ['formal'] },
  { name: 'Hana', role: 'Support lead', color: '#2b8a86', traits: ['warm'] },
  { name: 'Mina', role: 'Marketing', color: '#7a4fb0', traits: ['curious'] },
];

const PRESETS: Record<string, (Activity | undefined)[]> = {
  lobby: [],
  'floor-day': ['thinking', 'writing', 'calling', 'reviewing', 'reading', 'talking', 'talking', 'idle'],
  'floor-quiet': ['idle', 'idle', 'idle'],
  'floor-celebrate': ['celebrating', 'failed', 'writing', 'idle'],
  'floor-night': ['writing', 'idle', 'idle', 'idle', 'idle', 'idle'],
};

const PROVIDERS: OfficeProvider[] = [
  { id: 'github', name: 'GitHub', color: '#333b43', degraded: false },
  { id: 'linear', name: 'Linear', color: '#6864d9', degraded: false },
];

const NOW = 1_800_000_000_000;

function buildScene(preset: string, hour: number, seed: number) {
  const roles = PRESETS[preset] ?? PRESETS['floor-day'];
  const count = preset === 'lobby' ? 6 : roles.length;
  const employees: OfficeEmployee[] = PEOPLE.slice(0, count).map((person, index) => ({
    id: `lab-${seed}-${index}`,
    name: person.name,
    role: person.role,
    status: roles[index] && roles[index] !== 'idle' ? 'working' : 'ready',
    color: person.color,
    traits: person.traits,
  }));
  const activities = new Map<string, EmployeeActivity>();
  employees.forEach((employee, index) => {
    const activity = roles[index];
    if (!activity) return;
    const partner = activity === 'talking' ? employees[index % 2 === 0 ? index + 1 : index - 1] : undefined;
    activities.set(employee.id, {
      activity,
      since: NOW - 10_000 - index * 1_000,
      bubble:
        activity === 'writing'
          ? 'The changelog is ready. I need approval before writing the release note.'
          : activity === 'talking' && index % 2 === 0
            ? 'Take the release note from here; the copy is signed off.'
            : undefined,
      attention: activity === 'reviewing' ? 'approval' : undefined,
      partnerId: partner?.id,
    });
  });
  const scene: OfficeSceneData = {
    activities,
    traits: new Map(employees.map((employee) => [employee.id, employee.traits ?? []])),
    providers: preset === 'lobby' ? [] : PROVIDERS,
    note: preset === 'lobby' ? undefined : 'Ship the September release once the changelog is approved.',
    lightBudget: preset === 'floor-night' ? 0.8 : 0.2,
    hour,
  };
  return { employees, scene };
}

export function OfficeLab({
  preset,
  hour,
  labels,
  seed,
}: {
  preset: string;
  hour: number;
  labels: string;
  seed: number;
}) {
  const { employees, scene } = useMemo(() => buildScene(preset, hour, seed), [preset, hour, seed]);
  return (
    <main className="office-lab" data-preset={preset} style={{ width: 1280, height: 720, margin: 0 }}>
      <OfficeStage
        live={false}
        scene={scene}
        employees={employees}
        floorId={preset === 'lobby' ? undefined : `lab-floor-${seed}`}
        label={preset === 'lobby' ? 'Lobby' : 'Floor 1 · Release desk'}
        labels={labels as LabelMode}
      />
    </main>
  );
}
