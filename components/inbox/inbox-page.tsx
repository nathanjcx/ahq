'use client';

import { ArrowRight, ExternalLink, Inbox, MessageSquareText, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Employee, InboxItem, Project } from '@/lib/contracts';
import { EmptyPane } from '../shared/empty';
import { providerName, relativeTime } from '../shared/format';
import { ProviderMark } from '../shared/marks';
import { PageIntro } from '../shared/page-intro';

export function InboxPage({
  items,
  employees,
  projects,
  configured,
  onRead,
  onAssign,
}: {
  items: InboxItem[];
  employees: Employee[];
  projects: Project[];
  configured: boolean;
  onRead: (id: string) => void;
  onAssign: (itemId: string, employeeId: string, projectId?: string) => void;
}) {
  const [selected, setSelected] = useState(items[0]?.id ?? null);
  const item = items.find((entry) => entry.id === selected);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [projectId, setProjectId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const shown = filter === 'unread' ? items.filter((entry) => entry.status === 'unread') : items;
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const selectedProject = activeProjects.find((project) => project.id === projectId);
  const eligibleEmployees = selectedProject
    ? employees.filter((employee) => selectedProject.employeeIds.includes(employee.id))
    : employees;
  useEffect(() => {
    if (employeeId && !eligibleEmployees.some((employee) => employee.id === employeeId)) setEmployeeId('');
  }, [eligibleEmployees, employeeId]);
  useEffect(() => {
    setProjectId('');
    setEmployeeId('');
  }, [selected]);
  return (
    <div>
      <PageIntro
        eyebrow="CONNECTED WORK"
        title="Inbox"
        description="New work from your approved integrations, ready to review or assign."
      />
      <div className="split-card card">
        <div className="list-pane">
          <div className="pane-toolbar">
            <div className="segmented">
              <button data-active={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </button>
              <button data-active={filter === 'unread'} onClick={() => setFilter('unread')}>
                Unread
              </button>
            </div>
            <button className="icon-button" aria-label="Refresh inbox">
              <RefreshCw size={15} />
            </button>
          </div>
          {shown.length ? (
            <div className="inbox-list">
              {shown.map((entry) => (
                <button
                  key={entry.id}
                  data-active={selected === entry.id}
                  onClick={() => {
                    setSelected(entry.id);
                    if (entry.status === 'unread') onRead(entry.id);
                  }}
                >
                  <ProviderMark provider={entry.provider} />
                  <span>
                    <strong>{entry.title}</strong>
                    <small>{entry.preview}</small>
                    <time>{relativeTime(entry.createdAt)}</time>
                  </span>
                  {entry.status === 'unread' && <i className="unread-dot" />}
                </button>
              ))}
            </div>
          ) : (
            <EmptyPane
              icon={<Inbox size={23} />}
              title="Inbox zero"
              text={
                configured
                  ? 'New items from connected services will arrive here.'
                  : 'Connect the backend, then add an integration to receive work.'
              }
            />
          )}
        </div>
        <div className="detail-pane">
          {item ? (
            <>
              <div className="detail-heading">
                <ProviderMark provider={item.provider} />
                <div>
                  <span className="eyebrow">{providerName(item.provider)}</span>
                  <h2>{item.title}</h2>
                  <p>{relativeTime(item.createdAt)}</p>
                </div>
              </div>
              <div className="inbox-preview">{item.preview}</div>
              <div className="detail-actions">
                {item.taskId ? (
                  <a className="secondary-button" href="#tasks">
                    Already assigned · View tasks <ArrowRight size={15} />
                  </a>
                ) : (
                  <>
                    <label>
                      Project floor
                      <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                        <option value="">Lobby · Unassigned</option>
                        {activeProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Employee
                      <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                        <option value="">Choose an employee</option>
                        {eligibleEmployees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="primary-button compact"
                      disabled={
                        !employeeId ||
                        !configured ||
                        Boolean(projectId && !selectedProject) ||
                        item.status === 'assigned'
                      }
                      onClick={() => onAssign(item.id, employeeId, projectId || undefined)}
                    >
                      {item.status === 'assigned' ? 'Assigned' : 'Assign'}
                    </button>
                  </>
                )}
                {item.sourceUrl && (
                  <a className="secondary-button" href={item.sourceUrl} target="_blank" rel="noreferrer">
                    Open source <ExternalLink size={15} />
                  </a>
                )}
              </div>
            </>
          ) : (
            <EmptyPane
              icon={<MessageSquareText size={25} />}
              title="Choose an item"
              text="The source, details, and assignment controls will appear here."
            />
          )}
        </div>
      </div>
    </div>
  );
}
