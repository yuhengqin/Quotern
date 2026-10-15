/** Labels used by the imported pet speech renderer for subscription windows. */
const labels = {
  'limits.provider.ark_agent_plan': 'Ark Agent Plan',
  'limits.provider.command_code': 'Command Code',
  'limits.provider.devin': 'Devin',
  'limits.label.command_code_5h': '5h',
  'limits.label.command_code_weekly': 'Weekly',
  'limits.label.ark_agent_plan_weekly': 'Weekly',
  'limits.label.ark_agent_plan_monthly': 'Monthly',
  'limits.label.devin_daily': 'Daily',
  'limits.label.devin_weekly': 'Weekly',
};
export function copy(key) { return labels[key] || key; }
