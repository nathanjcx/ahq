import type { Employee } from '../../shared/types';
export default function Avatar({ employee, size = 36 }: { employee?: Employee; size?: number }) {
  const n = employee?.avatar ?? 6;
  const skin =
    employee?.appearance?.skin ??
    ['#b98461', '#d6a17c', '#bc8f72', '#d8a57e', '#b87856', '#d8ad89', '#d7aa85'][n % 7];
  const hair =
    employee?.appearance?.hair ??
    ['#382923', '#392e24', '#232c30', '#584031', '#472b25', '#675640', '#493c31'][n % 7];
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: employee?.color ?? '#d9dfca' }}
      aria-label={employee?.name ?? 'You'}
    >
      <svg viewBox="0 0 48 48" role="img" aria-hidden="true">
        <ellipse
          cx="24"
          cy="45"
          rx="18"
          ry="14"
          fill={
            employee?.appearance?.clothing ??
            ['#eee2ce', '#334d42', '#344857', '#e4dcc6', '#c0a7a1', '#e4e3d4', '#324b40'][n % 7]
          }
        />
        {(employee?.appearance ? employee.appearance.hairstyle === 'long' : [0, 2, 4].includes(n)) && (
          <ellipse cx="24" cy="24" rx="13" ry="17" fill={hair} />
        )}
        <path d="M19 29h10v9c-3 4-7 4-10 0z" fill={skin} />
        <ellipse cx="24" cy="22" rx="10" ry="13" fill={skin} />
        {employee?.appearance?.hairstyle !== 'bald' && (
          <path
            d={n % 2 ? 'M13 20C9 1 37 2 35 21l-6-8-14 6z' : 'M13 24C7 1 39 2 35 26l-4-12c-6 7-13 5-18 10z'}
            fill={hair}
          />
        )}
        {employee?.appearance?.hat && employee.appearance.hat !== 'none' && (
          <path d="M12 16C12 1 36 1 36 16z" fill={employee.appearance.clothing} />
        )}
        {employee?.appearance?.hat === 'cap' && (
          <path d="M11 16h29v3H11z" fill={employee.appearance.clothing} />
        )}
        {employee?.appearance?.glasses && (
          <g stroke="#303f37" fill="none" strokeWidth="1.4">
            <rect x="16" y="21" width="7" height="6" rx="2" />
            <rect x="25" y="21" width="7" height="6" rx="2" />
            <path d="M23 23h2" />
          </g>
        )}
        <path d="M20 25h.2m7.8 0h.2" stroke="#332b29" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M22 30q2 2 4 0" stroke="#995f50" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  );
}
