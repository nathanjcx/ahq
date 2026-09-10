import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import DemoPanel from '../../src/components/DemoPanel';
import OfficeScene from '../../src/components/OfficeScene';
import '../../src/styles.css';
import { employees } from '../../studio/app/data';
const team = employees.map((e) => ({
  ...e,
  jobTitle: e.role,
  activity: e.task,
  location: 'desk',
  avatar: 0,
}));
const ids = ['launch', 'investor', 'bug', 'reporter', 'celebrate'];
const titles = ['Build the launch', 'Investor email', 'Screenshot bug', 'Reporter briefing', 'Celebrate'];
window.check = {
  refreshes: 0,
  actions: [],
  events: 0,
  launch: { id: 'test', status: 'idle', projectName: 'Little Office', scenes: [], checkpoints: [] },
  demo: { notifications: [], sessions: [] },
};
const c = window.check;
const scenes = (current) =>
  ids.map((id, i) => ({
    id,
    title: titles[i],
    status: i < current ? 'completed' : i === current ? 'ready' : 'locked',
    sessionIds: i < current ? ['s' + i] : [],
  }));
window.ahq = {
  launchSnapshot: async () => structuredClone(c.launch),
  demoSnapshot: async () => structuredClone(c.demo),
  getSession: async (id) => ({
    id,
    title: 'Stream ' + id,
    status: 'running',
    activity: 'Writing forecast',
    events: [],
    messages: [
      { id: 'm', timestamp: new Date().toISOString(), complete: false, text: 'Investor revenue assumptions' },
    ],
  }),
  launchAction: async (action) => {
    c.actions.push(action);
    if (action.action === 'restore') {
      c.launch = { ...c.launch, status: 'running', scenes: scenes(1), celebrationId: undefined };
      c.demo = { notifications: [], sessions: [] };
    } else if (action.action === 'start') {
      c.launch = {
        ...c.launch,
        status: 'running',
        scenes: scenes(0),
        checkpoints: [{ id: 'cp', label: 'Launch ready', createdAt: new Date().toISOString() }],
      };
      c.launch.scenes[0].status = 'running';
      c.launch.scenes[0].sessionIds = ['product', 'marketing', 'forecast'];
    } else {
      const i = ids.indexOf(action.scene);
      c.launch.scenes = scenes(i + 1);
      if (i === 4) {
        c.launch.status = 'completed';
        c.launch.celebrationId = 'party-1';
      }
    }
    return structuredClone(c.launch);
  },
};
window.addEventListener('ahq:celebrate', () => c.events++);
window.readyScene = (i) => {
  c.launch = { ...c.launch, status: 'running', scenes: scenes(i) };
};
function Harness() {
  const [selected, setSelected] = useState(null);
  const [slap, setSlap] = useState(null);
  window.slap = () => setSlap({ employeeId: team[0].id, token: Date.now() });
  return (
    <>
      <div style={{ height: '100vh' }}>
        <OfficeScene
          employees={team}
          slapTarget={slap}
          animate={true}
          onSelect={() => {}}
          reviewEmployeeIds={[]}
          onReview={() => {}}
          zoom={1}
          timeSeconds={0}
          live={true}
          listening={false}
          microphoneLevel={0}
        />
      </div>
      <DemoPanel
        state={{ employees: [] }}
        onCreateGoal={async () => {}}
        onWorkUpdate={async () => {
          c.refreshes++;
        }}
        notify={() => {}}
        selectedSessionId={selected}
        onSelectSession={setSelected}
      />
    </>
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
