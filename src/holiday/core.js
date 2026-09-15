const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_KINDS = new Set(['block', 'legal', 'off', 'work']);
const VALID_ADJUSTMENT_TYPES = new Set(['rest', 'work']);
const VALID_PERIODS = new Set(['am', 'pm']);
const VALID_WEEKEND_REST_PERIODS = new Set(['full', 'am', 'pm']);

export const DEFAULT_SETTINGS = Object.freeze({
  anchorMonday: '2026-09-14',
  weekStartsOn: 6,
  weekendRules: {
    5: { restPeriod: 'full', repeatIntervalWeeks: 1 },
    6: { restPeriod: 'full', repeatIntervalWeeks: 0 }
  }
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
  const saturdayRule = getWeekendRule(5, settings);
  const hasSaturdayRest = saturdayRule.restPeriod !== 'none'
    && isWeekendRuleActive(dateKey, saturdayRule, settings);
  return hasSaturdayRest ? 'big' : 'small';
}

export function getWeekdayIndex(dateKey) {
  return (parseDate(dateKey).getUTCDay() + 6) % 7;
}

export function isBaseRestDay(dateKey, settings) {
  const weekday = getWeekdayIndex(dateKey);
  const rule = getWeekendRule(weekday, settings);
  return rule.restPeriod !== 'none' && isWeekendRuleActive(dateKey, rule, settings);
}

export function isBaseRestPeriod(dateKey, period, settings) {
  if (!VALID_PERIODS.has(period) || !isBaseRestDay(dateKey, settings)) {
    return false;
  }

  const weekday = getWeekdayIndex(dateKey);
  const configuredPeriod = getWeekendRule(weekday, settings).restPeriod;
  return configuredPeriod === 'full' || configuredPeriod === period;
}

function getWeekendRule(weekday, settings) {
  if (![5, 6].includes(weekday)) {
    return { restPeriod: 'none', repeatIntervalWeeks: 0 };
  }

  return settings.weekendRules?.[weekday] ?? DEFAULT_SETTINGS.weekendRules[weekday];
}

function isWeekendRuleActive(dateKey, rule, settings) {
  if (rule.repeatIntervalWeeks === 0) {
    return true;
  }

  const monday = parseDate(startOfWeek(dateKey));
  const anchor = parseDate(startOfWeek(settings.anchorMonday));
  const weekOffset = Math.round((monday - anchor) / DAY_MS / 7);
  const cycleWeeks = rule.repeatIntervalWeeks + 1;
  return (weekOffset % cycleWeeks + cycleWeeks) % cycleWeeks === 0;
}

function getBaseRestAmount(dateKey, settings) {
  return ['am', 'pm'].filter((period) => isBaseRestPeriod(dateKey, period, settings)).length / 2;
}

function getRangeHalfDays(startDate, startPeriod, endDate, endPeriod) {
  if (!isDateKey(startDate) || !isDateKey(endDate)
    || !VALID_PERIODS.has(startPeriod) || !VALID_PERIODS.has(endPeriod)) {
    return 0;
  }

  const startOffset = startPeriod === 'pm' ? 1 : 0;
  const endOffset = endPeriod === 'pm' ? 1 : 0;
  const dayDifference = Math.round((parseDate(endDate) - parseDate(startDate)) / DAY_MS);
  if (dayDifference < 0 || (dayDifference === 0 && endOffset < startOffset)) {
    return 0;
  }

  return dayDifference * 2 + endOffset - startOffset + 1;
}

export function calculateAdjustmentDays(record, settings, holidays) {
  if (!record || !VALID_ADJUSTMENT_TYPES.has(record.type)) {
    return 0;
  }

  const halfDays = getRangeHalfDays(
    record.startDate,
    record.startPeriod,
    record.endDate,
    record.endPeriod
  );
  if (halfDays === 0) {
    return 0;
  }

  let total = 0;
  let dateKey = record.startDate;
  while (dateKey <= record.endDate) {
    const periods = ['am', 'pm'].filter((period) => isApplicableAdjustmentPeriod(
      record,
      dateKey,
      period,
      settings,
      holidays
    ));
    total += periods.length / 2;
    dateKey = addDays(dateKey, 1);
  }

  return total;
}

function isActualRestPeriod(dateKey, period, settings, holidays) {
  const sourcePeriods = {
    am: classifyPeriod(dateKey, 'am', settings, holidays),
    pm: classifyPeriod(dateKey, 'pm', settings, holidays)
  };
  const hasPureLegalPeriod = Object.values(sourcePeriods).some((item) => item.category === 'pure-legal');
  const sourcePeriod = sourcePeriods[period];
  return sourcePeriod.category === 'pure-legal' || (!hasPureLegalPeriod && sourcePeriod.baseRest);
}

function isApplicableAdjustmentPeriod(record, dateKey, period, settings, holidays) {
  if (!includesAdjustmentPeriod(record, dateKey, period)) {
    return false;
  }

  const isRestPeriod = isActualRestPeriod(dateKey, period, settings, holidays);
  return record.type === 'rest' ? !isRestPeriod : isRestPeriod;
}

export function hasAdjustmentOverlap(record, records, settings, holidays) {
  const halfDays = getRangeHalfDays(
    record?.startDate,
    record?.startPeriod,
    record?.endDate,
    record?.endPeriod
  );
  if (halfDays === 0 || !Array.isArray(records)) {
    return false;
  }

  let dateKey = record.startDate;
  while (dateKey <= record.endDate) {
    const hasConflict = ['am', 'pm'].some((period) => {
      if (!isApplicableAdjustmentPeriod(record, dateKey, period, settings, holidays)) {
        return false;
      }

      return records.some((existing) => existing.id !== record.id
        && isApplicableAdjustmentPeriod(existing, dateKey, period, settings, holidays));
    });
    if (hasConflict) {
      return true;
    }

    dateKey = addDays(dateKey, 1);
  }

  return false;
}

export function sanitizeAdjustmentRecords(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((record, index) => {
    if (!record || !VALID_ADJUSTMENT_TYPES.has(record.type)) {
      return [];
    }

    const halfDays = getRangeHalfDays(
      record.startDate,
      record.startPeriod,
      record.endDate,
      record.endPeriod
    );
    if (halfDays === 0) {
      return [];
    }

    return [{
      id: typeof record.id === 'string' && record.id ? record.id.slice(0, 80) : `imported-${index}`,
      type: record.type,
      startDate: record.startDate,
      startPeriod: record.startPeriod,
      endDate: record.endDate,
      endPeriod: record.endPeriod,
      note: typeof record.note === 'string' ? record.note.slice(0, 30) : '',
      createdAt: Number.isInteger(record.createdAt) && record.createdAt > 0 ? record.createdAt : index + 1
    }];
  });
}

export function getAdjustmentSummary(records, settings, holidays) {
  const totals = records.reduce(
    (summary, record) => {
      summary[record.type] += calculateAdjustmentDays(record, settings, holidays);
      return summary;
    },
    { rest: 0, work: 0 }
  );

  return {
    restTotal: totals.rest,
    workTotal: totals.work,
    restRemaining: Math.max(0, totals.rest - totals.work),
    workRemaining: Math.max(0, totals.work - totals.rest)
  };
}

function includesAdjustmentPeriod(record, dateKey, period) {
  if (!record || !VALID_ADJUSTMENT_TYPES.has(record.type)
    || !VALID_PERIODS.has(period)
    || dateKey < record.startDate
    || dateKey > record.endDate) {
    return false;
  }

  if (dateKey === record.startDate && period === 'am' && record.startPeriod === 'pm') {
    return false;
  }

  return !(dateKey === record.endDate && period === 'pm' && record.endPeriod === 'am');
}

function resolvePeriodResult(sourcePeriod, adjustmentRecords, hasPureLegalPeriod) {
  const sourceCategory = sourcePeriod.category;
  const isRest = sourceCategory === 'pure-legal' || (!hasPureLegalPeriod && sourcePeriod.baseRest);
  const category = isRest ? 'schedule-rest' : 'regular-work';
  const result = {
    ...sourcePeriod,
    sourceCategory,
    category,
    visualCategory: category,
    isRest,
    manualAdjustment: null,
    manualAdjustmentId: null
  };
  const record = Array.isArray(adjustmentRecords)
    ? adjustmentRecords.find((item) => includesAdjustmentPeriod(item, sourcePeriod.dateKey, sourcePeriod.period)
      && (item.type === 'rest' ? !isRest : isRest))
    : null;
  if (!record) {
    return result;
  }

  const manualIsRest = record.type === 'rest';
  const resolvedCategory = manualIsRest ? 'manual-rest' : 'manual-work';
  return {
    ...result,
    isRest: manualIsRest,
    category: resolvedCategory,
    visualCategory: resolvedCategory,
    manualAdjustment: record.type,
    manualAdjustmentId: record.id
  };
}

function getOfficialLabel(sourcePeriods, sourceCategory, label, requireFullDay = false) {
  const periods = ['am', 'pm'].filter((period) => sourcePeriods[period].category === sourceCategory);
  return periods.length > 0 && (!requireFullDay || periods.length === 2) ? label : null;
}

function getBlockPureLegalDates(block, settings) {
  const fullWorkingDates = [];
  let currentDate = block.startDay;
  while (currentDate <= block.endDay) {
    const isFullWorkingDay = ['am', 'pm'].every((period) => !isBaseRestPeriod(currentDate, period, settings));
    if (isFullWorkingDay) {
      fullWorkingDates.push(currentDate);
    }
    currentDate = addDays(currentDate, 1);
  }

  return fullWorkingDates.slice(0, block.legalDays);
}

function classifyHolidayBlockPeriod(dateKey, period, settings, block, weekType, baseRest) {
  if (getBlockPureLegalDates(block, settings).includes(dateKey)) {
    return {
      dateKey,
      period,
      weekType,
      baseRest,
      holiday: { kind: 'legal', name: block.name },
      isRest: true,
      isPureLegal: true,
      category: 'pure-legal'
    };
  }

  if (!baseRest) {
    return {
      dateKey,
      period,
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
    period,
    weekType,
    baseRest,
    holiday: null,
    isRest: true,
    isPureLegal: false,
    category: 'schedule-rest'
  };
}

export function classifyPeriod(dateKey, period, settings, holidays) {
  const weekType = getWeekType(dateKey, settings);
  const baseRest = isBaseRestPeriod(dateKey, period, settings);
  const holiday = holidays[dateKey] ?? null;

  if (holiday?.kind === 'block') {
    return classifyHolidayBlockPeriod(dateKey, period, settings, holiday, weekType, baseRest);
  }

  if (holiday?.kind === 'work') {
    return {
      dateKey,
      period,
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
    return {
      dateKey,
      period,
      weekType,
      baseRest,
      holiday,
      isRest: true,
      isPureLegal: true,
      category: 'pure-legal'
    };
  }

  if (holiday?.kind === 'off') {
    if (baseRest) {
      return {
        dateKey,
        period,
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
      period,
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
    period,
    weekType,
    baseRest,
    holiday: null,
    isRest: baseRest,
    isPureLegal: false,
    category: baseRest ? 'schedule-rest' : 'regular-work'
  };
}

export function classifyDay(dateKey, settings, holidays, adjustmentRecords = []) {
  const sourcePeriods = {
    am: classifyPeriod(dateKey, 'am', settings, holidays),
    pm: classifyPeriod(dateKey, 'pm', settings, holidays)
  };
  const hasPureLegalPeriod = Object.values(sourcePeriods).some((period) => period.category === 'pure-legal');
  const periods = {
    am: resolvePeriodResult(sourcePeriods.am, adjustmentRecords, hasPureLegalPeriod),
    pm: resolvePeriodResult(sourcePeriods.pm, adjustmentRecords, hasPureLegalPeriod)
  };
  const values = Object.values(periods);
  const sourceValues = Object.values(sourcePeriods);
  const categoryPriority = ['manual-rest', 'manual-work', 'makeup-off', 'schedule-rest', 'regular-work'];
  const category = categoryPriority.find((item) => values.some((period) => period.category === item));
  const restAmount = values.filter((period) => period.isRest).length / 2;
  const pureLegalAmount = sourceValues.filter((period) => period.isPureLegal).length / 2;
  const scheduleRestAmount = sourceValues.filter((period) => period.category === 'schedule-rest').length / 2;
  const adjustedWorkAmount = sourceValues.filter((period) => period.category === 'adjusted-work').length / 2;
  const holiday = sourceValues.find((period) => period.holiday)?.holiday ?? null;
  const manualAdjustment = values.find((period) => period.manualAdjustment)?.manualAdjustment ?? null;
  const officialLabels = [
    getOfficialLabel(sourcePeriods, 'pure-legal', '放假'),
    getOfficialLabel(sourcePeriods, 'makeup-off', '法定调休', true),
    getOfficialLabel(sourcePeriods, 'adjusted-work', '法定补班')
  ].filter(Boolean);

  return {
    dateKey,
    weekType: periods.am.weekType,
    baseRest: getBaseRestAmount(dateKey, settings) > 0,
    baseRestAmount: getBaseRestAmount(dateKey, settings),
    holiday,
    periods,
    restAmount,
    pureLegalAmount,
    scheduleRestAmount,
    adjustedWorkAmount,
    isRest: restAmount > 0,
    isPureLegal: pureLegalAmount > 0,
    category,
    visualCategory: category,
    manualAdjustment,
    officialLabels
  };
}

export function getConsecutiveRestState(dateKey, settings, holidays, adjustmentRecords = []) {
  const currentDay = classifyDay(dateKey, settings, holidays, adjustmentRecords);
  if (currentDay.restAmount !== 1) {
    return { isConsecutive: false, hasPrevious: false, hasNext: false };
  }

  const adjacentRest = [-2, -1, 1, 2].map((offset) => classifyDay(
    addDays(dateKey, offset),
    settings,
    holidays,
    adjustmentRecords
  ).restAmount === 1);
  const [twoDaysBefore, previousDay, nextDay, twoDaysAfter] = adjacentRest;
  const isConsecutive = (previousDay && (twoDaysBefore || nextDay))
    || (nextDay && twoDaysAfter);

  return {
    isConsecutive,
    hasPrevious: isConsecutive && previousDay,
    hasNext: isConsecutive && nextDay
  };
}

export function buildMonthGrid(year, month, weekStartsOn = DEFAULT_SETTINGS.weekStartsOn) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const leadingDays = (getWeekdayIndex(firstDay) - weekStartsOn + 7) % 7;
  const gridStart = addDays(firstDay, -leadingDays);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function getMonthSummary(year, month, settings, holidays, adjustmentRecords = []) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const days = buildMonthGrid(year, month, settings.weekStartsOn).filter((dateKey) => dateKey.startsWith(prefix));

  return days.reduce(
    (summary, dateKey) => {
      const day = classifyDay(dateKey, settings, holidays, adjustmentRecords);
      summary.totalRest += day.restAmount;
      summary.pureLegal += day.pureLegalAmount;
      summary.scheduleRest += day.scheduleRestAmount;
      summary.adjustedWork += day.adjustedWorkAmount;
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
        weekType: day.weekType,
        days: day.pureLegalAmount,
        period: day.periods.am.sourceCategory === 'pure-legal'
          ? day.periods.pm.sourceCategory === 'pure-legal' ? 'full' : 'am'
          : 'pm'
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
        name = name.replaceAll('调休上班', '法定补班').replaceAll('法定调休', '法定补班');
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
  const normalizeWeekendRule = (weekday) => {
    const rule = input?.weekendRules?.[weekday];
    const hasValidPeriod = VALID_WEEKEND_REST_PERIODS.has(rule?.restPeriod) || rule?.restPeriod === 'none';
    const hasValidInterval = Number.isInteger(rule?.repeatIntervalWeeks)
      && rule.repeatIntervalWeeks >= 0
      && rule.repeatIntervalWeeks <= 52;
    if (hasValidPeriod && hasValidInterval) {
      return { restPeriod: rule.restPeriod, repeatIntervalWeeks: rule.repeatIntervalWeeks };
    }

    const bigPeriod = input?.weekendRestPeriods?.big?.[weekday];
    const smallPeriod = input?.weekendRestPeriods?.small?.[weekday];
    if ((VALID_WEEKEND_REST_PERIODS.has(bigPeriod) || bigPeriod === 'none')
      && (VALID_WEEKEND_REST_PERIODS.has(smallPeriod) || smallPeriod === 'none')) {
      if (bigPeriod === smallPeriod) {
        return { restPeriod: bigPeriod, repeatIntervalWeeks: 0 };
      }

      const anchorPeriod = input?.anchorWeekType === 'small' ? smallPeriod : bigPeriod;
      return { restPeriod: anchorPeriod, repeatIntervalWeeks: 1 };
    }

    const bigRest = Array.isArray(input?.bigRestDays) && input.bigRestDays.includes(weekday);
    const smallRest = Array.isArray(input?.smallRestDays) && input.smallRestDays.includes(weekday);
    if (Array.isArray(input?.bigRestDays) || Array.isArray(input?.smallRestDays)) {
      const legacyPeriod = weekday === 5 ? input?.saturdayRestPeriod : input?.sundayRestPeriod;
      const restPeriod = VALID_WEEKEND_REST_PERIODS.has(legacyPeriod) ? legacyPeriod : 'full';
      return {
        restPeriod: bigRest || smallRest ? restPeriod : 'none',
        repeatIntervalWeeks: bigRest !== smallRest ? 1 : 0
      };
    }

    return { ...DEFAULT_SETTINGS.weekendRules[weekday] };
  };

  return {
    anchorMonday: isDateKey(settings.anchorMonday) ? startOfWeek(settings.anchorMonday) : DEFAULT_SETTINGS.anchorMonday,
    weekStartsOn,
    weekendRules: {
      5: normalizeWeekendRule(5),
      6: normalizeWeekendRule(6)
    }
  };
}
