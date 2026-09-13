'use client';

import { Archive, ArrowRight, FileText } from 'lucide-react';
import { EmptySection } from '../shared/empty';
import { fileSize } from '../shared/format';
import { PageIntro } from '../shared/page-intro';
import { relativeTime } from '../shared/time';
import type { Artifact } from '@/lib/contracts';
import './files.css';

export function FilesPage({ artifacts, onTasks }: { artifacts: Artifact[]; onTasks: () => void }) {
  return (
    <div>
      <PageIntro
        eyebrow="OUTPUTS"
        title="Files"
        description="Artifacts created by your employees, with their task and source history attached."
      />
      {artifacts.length ? (
        <div className="file-grid">
          {artifacts.map((artifact) => (
            <a className="file-card card" key={artifact.id} href={`/api/files/${artifact.id}`}>
              <span className="file-icon">
                <FileText size={22} />
              </span>
              <div>
                <h3>{artifact.name}</h3>
                <p>
                  {fileSize(artifact.size)} · {artifact.mediaType}
                </p>
                <time>{relativeTime(artifact.createdAt)}</time>
              </div>
              <ArrowRight size={16} />
            </a>
          ))}
        </div>
      ) : (
        <EmptySection
          icon={<Archive size={29} />}
          title="No files yet"
          text="Files your employees produce are listed here with the task that made them."
          action={
            <button className="secondary-button" onClick={onTasks}>
              View tasks
            </button>
          }
        />
      )}
    </div>
  );
}
