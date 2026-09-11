export function taskReservation(model: string) {
  const global = Number(process.env.TASK_RESERVED_COST_USD);
  if (Number.isFinite(global) && global > 0) return global;
  const defaults: Record<string, number> = {
    'gpt-5.6-luna': 0.25,
    'gpt-5.6-terra': 1,
    'gpt-5.6-sol': 2,
    'gpt-6-astra': 5,
  };
  const envName = `TASK_RESERVED_COST_USD_${model.split('-').at(-1)?.toUpperCase()}`;
  const configured = Number(process.env[envName]);
  return Number.isFinite(configured) && configured > 0 ? configured : defaults[model] || 1;
}
