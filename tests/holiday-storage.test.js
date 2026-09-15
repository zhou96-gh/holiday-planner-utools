import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_HOLIDAYS } from '../src/holiday/data.js';
import { DEFAULT_SETTINGS } from '../src/holiday/core.js';
import {
  STORAGE_VERSION,
  decodeState,
  encodeState
} from '../src/holiday/storage.js';

test('节假日区间元数据只存一次，日期恢复与内置数据一致', () => {
  const state = {
    settings: DEFAULT_SETTINGS,
    holidays: BUILT_IN_HOLIDAYS,
    loadedYears: [2026],
    adjustments: []
  };
  const encoded = encodeState(state);
  assert.equal(encoded.version, STORAGE_VERSION);
  assert.equal(encoded.holidays, undefined);
  assert.equal(encoded.holidayData.blocks.length, 8);
  assert.equal(encoded.holidayData.blocks.filter((block) => 'dates' in block).length, 2);
  assert.equal(encoded.holidayData.blocks.find((block) => block.name === '除夕').dates.length, 1);
  assert.deepEqual(decodeState(encoded).holidays, BUILT_IN_HOLIDAYS);
});

test('区间中删除或修正单日后，稀疏日期可无损恢复', () => {
  const holidays = { ...BUILT_IN_HOLIDAYS };
  delete holidays['2026-10-03'];
  holidays['2026-10-04'] = { kind: 'work', name: '法定补班' };
  const state = { settings: DEFAULT_SETTINGS, holidays, loadedYears: [2026], adjustments: [] };
  const encoded = encodeState(state);
  const block = encoded.holidayData.blocks.find((item) => item.name === '国庆节');
  assert.equal(block.dates.includes('2026-10-03'), false);
  assert.equal(block.dates.includes('2026-10-04'), false);
  assert.deepEqual(decodeState(encoded).holidays, holidays);
});

test('新格式状态与记录往返，旧版本直接拒绝', () => {
  const adjustment = {
    id: 'test-rest', type: 'rest', startDate: '2026-09-14', startPeriod: 'am',
    endDate: '2026-09-14', endPeriod: 'pm', note: '测试', createdAt: 1
  };
  const state = {
    settings: DEFAULT_SETTINGS,
    holidays: BUILT_IN_HOLIDAYS,
    loadedYears: [2026],
    adjustments: [adjustment]
  };
  assert.deepEqual(decodeState(JSON.parse(JSON.stringify(encodeState(state)))).adjustments, [adjustment]);
  assert.throws(() => decodeState({ version: 5, holidays: BUILT_IN_HOLIDAYS }), /不支持的数据版本/);
  assert.throws(() => decodeState({ version: 6, holidayData: { blocks: [], days: null } }),
    /节假日存储格式无效/);
});
