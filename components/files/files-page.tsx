'use client';

import { Archive, Download } from 'lucide-react';
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
        title="Files"
        description="Artifacts created by your employees, with their task and source history attached."
      />
      {artifacts.length ? (
        <div className="card data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th className="num">Size</th>
                <th>When</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {artifacts.map((artifact) => {
                const ext = artifact.name.split('.').pop()?.toUpperCase() ?? '';
                return (
                  <tr key={artifact.id}>
                    <td>
                      <span className="who">
                        <span className="file-ext">{ext.slice(0, 5) || 'FILE'}</span>
                        <span>
                          <b>{artifact.name}</b>
                        </span>
                      </span>
                    </td>
                    <td className="dim">{artifact.mediaType}</td>
                    <td className="num dim">{fileSize(artifact.size)}</td>
                    <td className="dim">{relativeTime(artifact.createdAt)}</td>
                    <td className="chev">
                      <a className="text-button" href={`/api/files/${artifact.id}`}>
                        <Download size={14} /> Download
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
