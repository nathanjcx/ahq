import type { ReactNode } from 'react';

export function EmptySection({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-section card">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function EmptyPane({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-pane">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function EmptyMini({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-mini">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
