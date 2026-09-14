import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHolidayYear, transformHolidayPayload } from '../src/holiday/fetch.js';
import { DEFAULT_SETTINGS, classifyDay } from '../src/holiday/core.js';

const payload = {
  year: 2026,
  days: [
    ...Array.from({ length: 7 }, (_, index) => ({
      name: '国庆节',
      date: `2026-10-0${index + 1}`,
      isOffDay: true
    })),
    { name: '国庆节', date: '2026-09-20', isOffDay: false },
    { name: '国庆节', date: '2026-10-10', isOffDay: false }
  ]
};

test('远端年度数据会转换为法定区间和法定调休日', () => {
  const records = transformHolidayPayload(payload, 2026);
  assert.deepEqual(records['2026-09-20'], { kind: 'work', name: '国庆节法定调休' });
  assert.equal(records['2026-10-01'].kind, 'block');
  assert.equal(records['2026-10-01'].legalDays, 3);
  assert.equal(records['2026-10-01'].makeupDays, 2);
});

test('远端数据转换后继续遵守大小休显示规则', () => {
  const records = transformHolidayPayload(payload, 2026);
  const settings = {
    ...DEFAULT_SETTINGS,
    anchorMonday: '2026-09-14',
    anchorWeekType: 'big',
    bigRestDays: [5, 6],
    smallRestDays: [6]
  };
  assert.equal(classifyDay('2026-10-03', settings, records).category, 'schedule-rest');
  assert.equal(classifyDay('2026-10-05', settings, records).category, 'pure-legal');
  assert.equal(classifyDay('2026-10-06', settings, records).category, 'makeup-off');
});

test('主数据源失败时会使用备用地址', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 503 };
    }

    return { ok: true, json: async () => payload };
  };

  const records = await fetchHolidayYear(2026, fakeFetch);
  assert.equal(calls, 2);
  assert.equal(records['2026-10-01'].kind, 'block');
});

test('错误年份数据会被拒绝', () => {
  assert.throws(() => transformHolidayPayload({ ...payload, year: 2025 }, 2026), /格式无效/);
});
