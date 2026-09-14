import { addDays, isDateKey } from './core.js';

const HOLIDAY_SOURCES = [
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json',
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json'
];

function getLegalDayQuota(name, year) {
  const quotas = [
    ['元旦', 1],
    ['春节', year >= 2025 ? 4 : 3],
    ['清明', 1],
    ['劳动', year >= 2025 ? 2 : 1],
    ['端午', 1],
    ['中秋', 1],
    ['国庆', 3]
  ];

  return quotas.reduce((total, [keyword, days]) => total + (name.includes(keyword) ? days : 0), 0);
}

function splitConsecutiveDates(dates) {
  return dates.sort().reduce((groups, dateKey) => {
    const group = groups.at(-1);
    if (!group || addDays(group.at(-1), 1) !== dateKey) {
      groups.push([dateKey]);
    } else {
      group.push(dateKey);
    }
    return groups;
  }, []);
}

export function transformHolidayPayload(payload, requestedYear) {
  if (Number(payload?.year) !== requestedYear || !Array.isArray(payload?.days)) {
    throw new Error('节假日数据格式无效');
  }

  const records = {};
  const offDatesByName = new Map();
  const workDaysByName = new Map();

  payload.days.forEach((day) => {
    if (!day || !isDateKey(day.date) || !day.date.startsWith(`${requestedYear}-`) || typeof day.name !== 'string') {
      return;
    }

    if (day.isOffDay === true) {
      const dates = offDatesByName.get(day.name) ?? [];
      dates.push(day.date);
      offDatesByName.set(day.name, dates);
      return;
    }

    if (day.isOffDay === false) {
      records[day.date] = { kind: 'work', name: `${day.name}法定调休` };
      workDaysByName.set(day.name, (workDaysByName.get(day.name) ?? 0) + 1);
    }
  });

  offDatesByName.forEach((dates, name) => {
    const groups = splitConsecutiveDates(dates);
    let remainingLegalDays = getLegalDayQuota(name, requestedYear);
    let remainingMakeupDays = workDaysByName.get(name) ?? 0;

    groups.forEach((group, index) => {
      const isLastGroup = index === groups.length - 1;
      const legalDays = Math.min(remainingLegalDays, group.length);
      const makeupDays = isLastGroup ? remainingMakeupDays : 0;
      const startDay = group[0];
      const endDay = group.at(-1);

      group.forEach((dateKey) => {
        records[dateKey] = { kind: 'block', name, startDay, endDay, legalDays, makeupDays };
      });

      remainingLegalDays -= legalDays;
      if (isLastGroup) {
        remainingMakeupDays = 0;
      }
    });
  });

  if (Object.keys(records).length === 0) {
    throw new Error('该年份暂无节假日数据');
  }

  return records;
}

export async function fetchHolidayYear(year, fetchImplementation = fetch) {
  let lastError = null;

  for (const source of HOLIDAY_SOURCES) {
    try {
      const url = source.replace('{year}', String(year));
      const response = await fetchImplementation(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`数据源返回 ${response.status}`);
      }

      const payload = await response.json();
      return transformHolidayPayload(payload, year);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || '节假日数据获取失败');
}
