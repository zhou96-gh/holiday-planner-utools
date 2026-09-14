import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  buildMonthGrid,
  classifyDay,
  getMonthSummary,
  getWeekType,
  getYearLegalBreakdown,
  sanitizeHolidays,
  startOfWeek
} from '../src/holiday/core.js';
import { BUILT_IN_HOLIDAYS } from '../src/holiday/data.js';

const settings = {
  ...DEFAULT_SETTINGS,
  anchorMonday: '2026-09-14',
  anchorWeekType: 'big',
  bigRestDays: [5, 6],
  smallRestDays: [6]
};

test('锚点日期会归一化到周一', () => {
  assert.equal(startOfWeek('2026-09-20'), '2026-09-14');
});

test('月历默认从周日开始并支持切换起始日', () => {
  assert.equal(buildMonthGrid(2026, 9)[0], '2026-08-30');
  assert.equal(buildMonthGrid(2026, 9, 0)[0], '2026-08-31');
});

test('大小休按周交替且支持锚点之前的日期', () => {
  assert.equal(getWeekType('2026-09-14', settings), 'big');
  assert.equal(getWeekType('2026-09-21', settings), 'small');
  assert.equal(getWeekType('2026-09-07', settings), 'small');
});

test('大休周六休息，小休周六上班', () => {
  assert.equal(classifyDay('2026-09-19', settings, {}).category, 'schedule-rest');
  assert.equal(classifyDay('2026-09-26', settings, {}).category, 'regular-work');
});

test('法定日期落在原工作日时计入法定假', () => {
  const holidays = { '2026-09-25': { kind: 'legal', name: '中秋节' } };
  const result = classifyDay('2026-09-25', settings, holidays);
  assert.equal(result.category, 'pure-legal');
  assert.equal(result.isPureLegal, true);
});

test('法定日期与大小休重合时按普通休息显示', () => {
  const holidays = { '2026-09-27': { kind: 'legal', name: '示例假日' } };
  const result = classifyDay('2026-09-27', settings, holidays);
  assert.equal(result.category, 'schedule-rest');
  assert.equal(result.holiday, null);
  assert.equal(result.isPureLegal, false);
});

test('调休不计入法定假', () => {
  const holidays = { '2026-09-24': { kind: 'off', name: '调休' } };
  const result = classifyDay('2026-09-24', settings, holidays);
  assert.equal(result.category, 'makeup-off');
  assert.equal(result.isPureLegal, false);
});

test('法定调休覆盖原大小休日', () => {
  const holidays = { '2026-09-20': { kind: 'work', name: '法定调休' } };
  const result = classifyDay('2026-09-20', settings, holidays);
  assert.equal(result.category, 'adjusted-work');
  assert.equal(result.visualCategory, 'schedule-rest');
  assert.equal(result.adjustment, 'adjusted-work');
  assert.equal(result.isRest, false);
});

test('月统计分别汇总法定假与法定调休', () => {
  const holidays = {
    '2026-09-20': { kind: 'work', name: '法定调休' },
    '2026-09-25': { kind: 'legal', name: '中秋节' },
    '2026-09-26': { kind: 'off', name: '中秋连休' },
    '2026-09-27': { kind: 'off', name: '中秋连休' }
  };
  const summary = getMonthSummary(2026, 9, settings, holidays);
  assert.equal(summary.pureLegal, 1);
  assert.equal(summary.adjustedWork, 1);
});

test('导入数据会剔除无效日期和类型', () => {
  const result = sanitizeHolidays({
    '2026-01-01': { kind: 'legal', name: '元旦' },
    '2026-13-40': { kind: 'legal', name: '错误日期' },
    '2026-01-02': { kind: 'unknown', name: '错误类型' }
  });
  assert.deepEqual(result, { '2026-01-01': { kind: 'legal', name: '元旦' } });
});

test('旧版调休名称会自动迁移', () => {
  const result = sanitizeHolidays({
    '2026-01-03': { kind: 'off', name: '元旦补假' },
    '2026-01-04': { kind: 'work', name: '元旦调休上班' }
  });
  assert.deepEqual(result, {
    '2026-01-03': { kind: 'off', name: '元旦调休' },
    '2026-01-04': { kind: 'work', name: '元旦法定调休' }
  });
});

test('内置 2026 数据包含 13 天法定额度和 6 个法定调休日', () => {
  const records = Object.values(BUILT_IN_HOLIDAYS);
  const blocks = [...new Map(
    records
      .filter((record) => record.kind === 'block')
      .map((record) => [record.startDay, record])
  ).values()];
  assert.equal(blocks.reduce((total, block) => total + block.legalDays, 0), 13);
  assert.equal(records.filter((record) => record.kind === 'work').length, 6);
});

test('内置安排保留 13 天法定假', () => {
  const breakdown = getYearLegalBreakdown(2026, settings, BUILT_IN_HOLIDAYS);
  assert.equal(breakdown.pure.length, 13);
});

test('国庆节 5 日为法定假，3 日为普通休息，6 日为调休', () => {
  assert.equal(classifyDay('2026-10-05', settings, BUILT_IN_HOLIDAYS).category, 'pure-legal');
  assert.equal(classifyDay('2026-10-03', settings, BUILT_IN_HOLIDAYS).category, 'schedule-rest');
  assert.equal(classifyDay('2026-10-06', settings, BUILT_IN_HOLIDAYS).category, 'makeup-off');
});

test('节假日区间内的小休周六仍按上班显示', () => {
  const result = classifyDay('2026-09-26', settings, BUILT_IN_HOLIDAYS);
  assert.equal(result.weekType, 'small');
  assert.equal(result.category, 'regular-work');
  assert.equal(result.isRest, false);
});
