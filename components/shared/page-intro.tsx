import type { ReactNode } from 'react';

export function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  // The top bar already names the page, so this is the page's one line and its primary action.
  return (
    <div className="page-intro">
      <p>
        <span className="sr-only">{title}. </span>
        {description}
      </p>
      {action}
    </div>
  );
}
