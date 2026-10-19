import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dashboardReturn from './dashboard-return-state.ts';

test('overview return state keeps the usage-attribution tab across filter saves', () => {
  assert.equal(typeof dashboardReturn.rememberDashboardSessionView, 'function');
  dashboardReturn.saveDashboardFilters('2026-10-18', ['codex']);
  dashboardReturn.rememberDashboardSessionView('billing');
  dashboardReturn.saveDashboardFilters('2026-10-18', ['codex']);
  assert.deepEqual(dashboardReturn.getDashboardReturnState(), {
    selectedDate: '2026-10-18', selectedTools: ['codex'], scrollTop: 0, sessionView: 'billing',
  });
});
