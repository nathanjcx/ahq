import { Fragment } from 'react';
function inline(text: string) {
  return text
    .split(/(\*\*.*?\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}
export default function Markdown({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="markdown">
      {lines.map((line, i) => {
        if (!line.trim()) return <div className="markdown-space" key={i} />;
        if (line.startsWith('### ')) return <h4 key={i}>{inline(line.slice(4))}</h4>;
        if (line.startsWith('## ')) return <h3 key={i}>{inline(line.slice(3))}</h3>;
        if (line.startsWith('# ')) return <h2 key={i}>{inline(line.slice(2))}</h2>;
        if (line.startsWith('|'))
          return (
            <div className={`markdown-table-row ${line.includes('---') ? 'table-divider' : ''}`} key={i}>
              {line
                .split('|')
                .slice(1, -1)
                .map((cell, j) => (
                  <span key={j}>{inline(cell.trim())}</span>
                ))}
            </div>
          );
        if (line.startsWith('- '))
          return (
            <p className="markdown-list" key={i}>
              <span>•</span>
              {inline(line.slice(2))}
            </p>
          );
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}
