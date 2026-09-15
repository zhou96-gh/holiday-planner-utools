import {
  DEFAULT_SETTINGS,
  addDays,
  isDateKey,
  parseDate,
  sanitizeAdjustmentRecords,
  sanitizeHolidays,
  sanitizeSettings
} from './core.js';

export const STORAGE_VERSION = 6;

function sanitizeLoadedYears(years) {
  if (!Array.isArray(years)) {
    return [];
  }

  return [...new Set(years.filter((year) => Number.isInteger(year)
    && year >= 1900 && year <= 2200))].sort();
}

export function encodeState(state) {
  return {
    version: STORAGE_VERSION,
    settings: state.settings,
    holidayData: encodeHolidays(state.holidays),
    loadedYears: state.loadedYears,
    adjustments: state.adjustments
  };
}

export function decodeState(stored) {
  if (stored?.version !== STORAGE_VERSION) {
    throw new Error('不支持的数据版本');
  }

  return {
    version: STORAGE_VERSION,
    settings: sanitizeSettings(stored.settings ?? DEFAULT_SETTINGS),
    holidays: decodeHolidays(stored.holidayData),
    loadedYears: sanitizeLoadedYears(stored.loadedYears ?? [2026]),
    adjustments: sanitizeAdjustmentRecords(stored.adjustments)
  };
}

export { sanitizeLoadedYears };

export function encodeHolidays(holidays) {
  const blocks = new Map();
  const days = {};

  Object.entries(holidays).forEach(([dateKey, holiday]) => {
    if (holiday.kind !== 'block') {
      days[dateKey] = holiday;
      return;
    }

    const key = JSON.stringify([
      holiday.startDay,
      holiday.endDay,
      holiday.name,
      holiday.legalDays,
      holiday.makeupDays
    ]);
    if (!blocks.has(key)) {
      blocks.set(key, { ...holiday, dates: [] });
    }
    blocks.get(key).dates.push(dateKey);
  });

  return {
    blocks: [...blocks.values()].map((block) => {
      const dates = block.dates.sort();
      const expectedDays = Math.round(
        (parseDate(block.endDay) - parseDate(block.startDay)) / (24 * 60 * 60 * 1000)
      ) + 1;
      const { kind, ...fields } = block;
      if (dates.length === expectedDays && dates[0] === block.startDay
        && dates.at(-1) === block.endDay) {
        const { dates: unusedDates, ...fullBlock } = fields;
        return fullBlock;
      }

      return fields;
    }),
    days
  };
}

export function decodeHolidays(data) {
  if (!data || !Array.isArray(data.blocks)
    || !data.days || typeof data.days !== 'object' || Array.isArray(data.days)) {
    throw new Error('节假日存储格式无效');
  }

  const holidays = {};
  data.blocks.forEach((block) => {
    if (!isDateKey(block.startDay) || !isDateKey(block.endDay)
      || block.endDay < block.startDay) {
      throw new Error('节假日区间无效');
    }

    const dates = [];
    if (block.dates === undefined) {
      let dateKey = block.startDay;
      while (dateKey <= block.endDay && dates.length <= 366) {
        dates.push(dateKey);
        dateKey = addDays(dateKey, 1);
      }
    } else if (Array.isArray(block.dates)) {
      dates.push(...block.dates);
    } else {
      throw new Error('节假日区间日期无效');
    }

    if (dates.length === 0 || dates.length > 366
      || dates.some((dateKey) => !isDateKey(dateKey)
        || dateKey < block.startDay || dateKey > block.endDay)) {
      throw new Error('节假日区间日期无效');
    }

    dates.forEach((dateKey) => {
      holidays[dateKey] = {
        kind: 'block',
        name: block.name,
        startDay: block.startDay,
        endDay: block.endDay,
        legalDays: block.legalDays,
        makeupDays: block.makeupDays
      };
    });
  });

  return sanitizeHolidays({ ...holidays, ...data.days });
}
