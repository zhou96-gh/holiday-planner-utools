const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_KINDS = new Set(['block', 'legal', 'off', 'work']);

export const DEFAULT_SETTINGS = Object.freeze({
  anchorMonday: '2026-09-14',
  anchorWeekType: 'big',
  weekStartsOn: 6,
  bigRestDays: [5, 6],
  smallRestDays: [6]
});

export function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return toDateKey(date) === value;
}

export function parseDate(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`);
}

export function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateKey, days) {
  const date = parseDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

export function startOfWeek(dateKey) {
  const date = parseDate(dateKey);
  const mondayIndex = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayIndex);
  return toDateKey(date);
}

export function getWeekType(dateKey, settings) {
  const monday = parseDate(startOfWeek(dateKey));
  const anchor = parseDate(startOfWeek(settings.anchorMonday));
  const weekOffset = Math.round((monday - anchor) / DAY_MS / 7);
  const isAnchorPattern = ((weekOffset % 2) + 2) % 2 === 0;

  if (isAnchorPattern) {
    return settings.anchorWeekType;
  }

  return settings.anchorWeekType === 'big' ? 'small' : 'big';
}

export function getWeekdayIndex(dateKey) {
  return (parseDate(dateKey).getUTCDay() + 6) % 7;
}

export function isBaseRestDay(dateKey, settings) {
  const weekType = getWeekType(dateKey, settings);
  const restDays = weekType === 'big' ? settings.bigRestDays : settings.smallRestDays;
  return restDays.includes(getWeekdayIndex(dateKey));
}

function classifyHolidayBlock(dateKey, settings, block, weekType, baseRest) {
  if (baseRest) {
    return {
      dateKey,
      weekType,
      baseRest,
      holiday: null,
      isRest: true,
      isPureLegal: false,
      category: 'schedule-rest'
    };
  }

  const blockDates = [];
  let currentDate = block.startDay;
  while (currentDate <= block.endDay) {
    blockDates.push(currentDate);
    currentDate = addDays(currentDate, 1);
  }

  const workingDates = blockDates.filter((item) => !isBaseRestDay(item, settings));
  const legalDates = workingDates.slice(0, block.legalDays);
  const remainingWorkingDates = workingDates.slice(block.legalDays);
  const makeupDates = block.makeupDays > 0 ? remainingWorkingDates.slice(-block.makeupDays) : [];

  if (legalDates.includes(dateKey)) {
    return {
      dateKey,
      weekType,
      baseRest,
      holiday: { kind: 'legal', name: block.name },
      isRest: true,
      isPureLegal: true,
      category: 'pure-legal'
    };
  }

  if (makeupDates.includes(dateKey)) {
    return {
      dateKey,
      weekType,
      baseRest,
      holiday: { kind: 'off', name: `${block.name}调休` },
      isRest: true,
      isPureLegal: false,
      category: 'makeup-off'
    };
  }

  return {
    dateKey,
    weekType,
    baseRest,
    holiday: null,
    isRest: false,
    isPureLegal: false,
    category: 'regular-work'
  };
}

export function classifyDay(dateKey, settings, holidays) {
  const weekType = getWeekType(dateKey, settings);
  const baseRest = isBaseRestDay(dateKey, settings);
  const holiday = holidays[dateKey] ?? null;

  if (holiday?.kind === 'block') {
    return classifyHolidayBlock(dateKey, settings, holiday, weekType, baseRest);
  }

  if (holiday?.kind === 'work') {
    return {
      dateKey,
      weekType,
      baseRest,
      holiday,
      isRest: false,
      isPureLegal: false,
      category: 'adjusted-work',
      visualCategory: baseRest ? 'schedule-rest' : 'regular-work',
      adjustment: 'adjusted-work'
    };
  }

  if (holiday?.kind === 'legal') {
    const isPureLegal = !baseRest;
    if (!isPureLegal) {
      return {
        dateKey,
        weekType,
        baseRest,
        holiday: null,
        isRest: true,
        isPureLegal: false,
        category: 'schedule-rest'
      };
    }

    return {
      dateKey,
      weekType,
      baseRest,
      holiday,
      isRest: true,
      isPureLegal,
      category: 'pure-legal'
    };
  }

  if (holiday?.kind === 'off') {
    if (baseRest) {
      return {
        dateKey,
        weekType,
        baseRest,
        holiday: null,
        isRest: true,
        isPureLegal: false,
        category: 'schedule-rest'
      };
    }

    return {
      dateKey,
      weekType,
      baseRest,
      holiday,
      isRest: true,
      isPureLegal: false,
      category: 'makeup-off'
    };
  }

  return {
    dateKey,
    weekType,
    baseRest,
    holiday: null,
    isRest: baseRest,
    isPureLegal: false,
    category: baseRest ? 'schedule-rest' : 'regular-work'
  };
}

export function buildMonthGrid(year, month, weekStartsOn = DEFAULT_SETTINGS.weekStartsOn) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const leadingDays = (getWeekdayIndex(firstDay) - weekStartsOn + 7) % 7;
  const gridStart = addDays(firstDay, -leadingDays);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function getMonthSummary(year, month, settings, holidays) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const days = buildMonthGrid(year, month, settings.weekStartsOn).filter((dateKey) => dateKey.startsWith(prefix));

  return days.reduce(
    (summary, dateKey) => {
      const day = classifyDay(dateKey, settings, holidays);
      summary.totalRest += day.isRest ? 1 : 0;
      summary.pureLegal += day.isPureLegal ? 1 : 0;
      summary.scheduleRest += day.category === 'schedule-rest' ? 1 : 0;
      summary.adjustedWork += day.category === 'adjusted-work' ? 1 : 0;
      return summary;
    },
    { totalRest: 0, pureLegal: 0, scheduleRest: 0, adjustedWork: 0 }
  );
}

export function getYearLegalBreakdown(year, settings, holidays) {
  const prefix = `${year}-`;
  const pure = [];
  const excluded = [];

  Object.keys(holidays)
    .filter((dateKey) => dateKey.startsWith(prefix))
    .sort()
    .forEach((dateKey) => {
      const day = classifyDay(dateKey, settings, holidays);
      if (!day.isPureLegal) {
        return;
      }

      const item = {
        dateKey,
        name: day.holiday.name,
        weekType: day.weekType
      };
      pure.push(item);
    });

  return { pure, excluded };
}

export function sanitizeHolidays(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input).flatMap(([dateKey, value]) => {
      if (!isDateKey(dateKey) || !value || !VALID_KINDS.has(value.kind)) {
        return [];
      }

      let name = typeof value.name === 'string' ? value.name.slice(0, 30) : '';
      if (value.kind === 'work') {
        name = name.replaceAll('调休上班', '法定调休');
      } else if (value.kind === 'off') {
        name = name.replaceAll('补假', '调休');
      }
      if (value.kind === 'block') {
        const validBlock = isDateKey(value.startDay)
          && isDateKey(value.endDay)
          && value.startDay <= dateKey
          && dateKey <= value.endDay
          && Number.isInteger(value.legalDays)
          && value.legalDays >= 0
          && Number.isInteger(value.makeupDays)
          && value.makeupDays >= 0;
        if (!validBlock) {
          return [];
        }

        return [[dateKey, {
          kind: 'block',
          name,
          startDay: value.startDay,
          endDay: value.endDay,
          legalDays: value.legalDays,
          makeupDays: value.makeupDays
        }]];
      }

      return [[dateKey, { kind: value.kind, name }]];
    })
  );
}

export function sanitizeSettings(input) {
  const settings = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  const hasValidWeekStart = Number.isInteger(settings.weekStartsOn)
    && settings.weekStartsOn >= 0
    && settings.weekStartsOn <= 6;
  const weekStartsOn = hasValidWeekStart ? settings.weekStartsOn : DEFAULT_SETTINGS.weekStartsOn;
  const normalizeDays = (days, fallback) => {
    if (!Array.isArray(days)) {
      return [...fallback];
    }

    return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  };

  return {
    anchorMonday: isDateKey(settings.anchorMonday) ? startOfWeek(settings.anchorMonday) : DEFAULT_SETTINGS.anchorMonday,
    anchorWeekType: settings.anchorWeekType === 'small' ? 'small' : 'big',
    weekStartsOn,
    bigRestDays: normalizeDays(settings.bigRestDays, DEFAULT_SETTINGS.bigRestDays),
    smallRestDays: normalizeDays(settings.smallRestDays, DEFAULT_SETTINGS.smallRestDays)
  };
}
