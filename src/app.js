import { BUILT_IN_HOLIDAYS } from './holiday/data.js';
import { fetchHolidayYear } from './holiday/fetch.js';
import {
  STORAGE_VERSION,
  CUSTOM_COLOR_TOKENS,
  decodeState,
  decodeCustomColorsImport,
  encodeState,
  sanitizeLoadedYears
} from './holiday/storage.js';
import {
  DEFAULT_SETTINGS,
  buildMonthGrid,
  calculateAdjustmentDays,
  classifyDay,
  getAdjustmentSummary,
  getAdjustmentRanges,
  getConsecutiveRestState,
  getMonthSummary,
  getYearLegalBreakdown,
  hasAdjustmentOverlap,
  mergeAssociatedAdjustment,
  pruneExpiredAdjustments,
  sanitizeAdjustmentRecords,
  sanitizeSettings,
  startOfWeek
} from './holiday/core.js';

const STORAGE_KEY = 'holiday-planner-state-v7';
const LEGACY_STORAGE_KEYS = [
  'holiday-planner-state-v6',
  'holiday-planner-state-v5',
  'holiday-planner-state-v4',
  'holiday-planner-state-v3'
];
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const LUNAR_DAY_LABELS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
];
const LUNAR_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  month: 'long',
  day: 'numeric'
});
const CATEGORY_LABELS = {
  'pure-legal': '休息',
  'makeup-off': '调休',
  'schedule-rest': '休息',
  'adjusted-work': '上班',
  'regular-work': '上班',
  'manual-rest': '调休',
  'manual-work': '补班'
};
const WEEKEND_PRESETS = {
  double: {
    5: { restPeriod: 'full', repeatIntervalWeeks: 0 },
    6: { restPeriod: 'full', repeatIntervalWeeks: 0 }
  },
  single: {
    5: { restPeriod: 'none', repeatIntervalWeeks: 0 },
    6: { restPeriod: 'full', repeatIntervalWeeks: 0 }
  },
  alternating: {
    5: { restPeriod: 'full', repeatIntervalWeeks: 1 },
    6: { restPeriod: 'full', repeatIntervalWeeks: 0 }
  }
};

const COLOR_DEFAULTS = {
  light: {
    page: '#eef0ed', surface: '#ffffff', panel: '#f8f9f7',
    'panel-muted': '#f1f3f1', header: '#202522', 'header-text': '#ffffff',
    'header-muted': '#b9c0bb', text: '#202522', muted: '#66706a',
    faint: '#89908c', 'toc-bg': '#f8f9f7f5',
    border: '#d8ddda', 'border-strong': '#cfd5d1', control: '#e8ebe8',
    hover: '#f4f6f4', 'warm-hover': '#f4e9e7', 'badge-bg': '#dcece8',
    primary: '#d94b3d', 'primary-hover': '#bf3d31', 'primary-text': '#ffffff',
    'error-strong': '#a83a31',
    'rest-bg': '#edf7f4', 'holiday-bg': '#fde9e6', 'manual-rest-bg': '#fff4cf',
    'manual-work-bg': '#f2eef8', green: '#267568', red: '#b5453b',
    purple: '#60478f', gold: '#966108', stripe: '#26756824',
    'tag-work-bg': '#e7def4', 'tag-suggestion-bg': '#fff0cf', 'tag-holiday-bg': '#f8deda',
    'preview-bg': '#eef5f2', 'preview-error-bg': '#f8ebe9', 'tag-neutral-bg': '#20252214'
  },
  dark: {
    page: '#303633', surface: '#48514a', panel: '#3e4741',
    'panel-muted': '#515b53', header: '#292f2c', 'header-text': '#f9faf8',
    'header-muted': '#d4ddd5', text: '#f7f9f6', muted: '#d1dbd3',
    faint: '#b9c6bc', 'toc-bg': '#3e4741f2',
    border: '#758178', 'border-strong': '#94a296', control: '#56615a',
    hover: '#606b61', 'warm-hover': '#654c4d', 'badge-bg': '#435e4e',
    primary: '#f0bb9f', 'primary-hover': '#ffd0b1', 'primary-text': '#2f3430',
    'error-strong': '#f0aaa4',
    'rest-bg': '#465b4e', 'holiday-bg': '#5c4d50', 'manual-rest-bg': '#5e5544',
    'manual-work-bg': '#534e5e', green: '#bde6cf', red: '#ffd0c5',
    purple: '#e1d0ed', gold: '#f4dcaf', stripe: '#bde6cf3f',
    'tag-work-bg': '#5d536a', 'tag-suggestion-bg': '#6a5941', 'tag-holiday-bg': '#694c50',
    'preview-bg': '#495f50', 'preview-error-bg': '#624d50', 'tag-neutral-bg': '#ffffff24'
  }
};
const systemDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');
const builtInColorSchemes = new Map();

const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth() + 1;
let selectedDateKey = '';
let activeDateKey = toLocalDateKey(now);
let selectedAdjustmentId = '';
let editingAdjustmentId = '';
let selectedAdjustmentDateKey = '';
let selectedAdjustmentType = 'adjustment';
let associationType = 'none';
let activeAdjustmentRangeType = 'rest';
let rangeSequence = 0;
let toastTimer = null;
let state = loadState();
let colorEditMode = state.appearance === 'dark'
  || (state.appearance === 'system' && systemDarkMedia.matches) ? 'dark' : 'light';
const yearFetchStates = new Map();

const elements = {
  monthTitle: document.querySelector('#month-title'),
  calendarNavigation: document.querySelector('#calendar-navigation'),
  calendarView: document.querySelector('#calendar-view'),
  settingsView: document.querySelector('#settings-view'),
  appearanceMode: document.querySelector('#appearance-mode'),
  colorScheme: document.querySelector('#color-scheme'),
  colorMode: document.querySelector('#color-mode'),
  colorGrid: document.querySelector('#color-grid'),
  colorPreview: document.querySelector('#color-preview'),
  resetCustomColors: document.querySelector('#reset-custom-colors'),
  colorImportFile: document.querySelector('#color-import-file'),
  summaryBand: document.querySelector('#summary-band'),
  settingsToggle: document.querySelector('#settings-toggle'),
  settingsBack: document.querySelector('#settings-back'),
  settingsFloatingBack: document.querySelector('#settings-floating-back'),
  calendarGrid: document.querySelector('#calendar-grid'),
  weekdayHeader: document.querySelector('#weekday-header'),
  weekStartsOn: document.querySelector('#week-starts-on'),
  anchorMonday: document.querySelector('#anchor-monday'),
  summaryRest: document.querySelector('#summary-rest'),
  summaryPure: document.querySelector('#summary-pure'),
  summarySchedule: document.querySelector('#summary-schedule'),
  summaryRestBalance: document.querySelector('#summary-rest-balance'),
  summaryWorkBalance: document.querySelector('#summary-work-balance'),
  adjustmentRecordCount: document.querySelector('#adjustment-record-count'),
  adjustmentRecordList: document.querySelector('#adjustment-record-list'),
  resultYear: document.querySelector('#result-year'),
  yearPureCount: document.querySelector('#year-pure-count'),
  pureHolidayList: document.querySelector('#pure-holiday-list'),
  expiredHolidaySection: document.querySelector('#expired-holiday-section'),
  expiredHolidayCount: document.querySelector('#expired-holiday-count'),
  expiredHolidayList: document.querySelector('#expired-holiday-list'),
  dataStatus: document.querySelector('#data-status'),
  importFile: document.querySelector('#import-file'),
  editDate: document.querySelector('#edit-date'),
  editKind: document.querySelector('#edit-kind'),
  editName: document.querySelector('#edit-name'),
  datePreview: document.querySelector('#date-preview'),
  adjustmentDialog: document.querySelector('#adjustment-dialog'),
  adjustmentPicker: document.querySelector('#adjustment-picker'),
  adjustmentPickerTitle: document.querySelector('#adjustment-picker-title'),
  adjustmentPickerList: document.querySelector('#adjustment-picker-list'),
  newAdjustment: document.querySelector('#new-adjustment'),
  adjustmentForm: document.querySelector('#adjustment-form'),
  adjustmentDialogTitle: document.querySelector('#adjustment-dialog-title'),
  adjustmentType: document.querySelector('#adjustment-type'),
  associationControl: document.querySelector('#counterpart-type'),
  restRangeSection: document.querySelector('#rest-range-section'),
  workRangeSection: document.querySelector('#work-range-section'),
  restRangeList: document.querySelector('#rest-range-list'),
  workRangeList: document.querySelector('#work-range-list'),
  rangeTemplate: document.querySelector('#adjustment-range-template'),
  adjustmentFields: document.querySelector('#adjustment-fields'),
  correctionFields: document.querySelector('#correction-fields'),
  adjustmentNote: document.querySelector('#adjustment-note'),
  adjustmentPreview: document.querySelector('#adjustment-preview'),
  toast: document.querySelector('#toast')
};

function cloneBuiltInHolidays() {
  return JSON.parse(JSON.stringify(BUILT_IN_HOLIDAYS));
}

function storageRead(key) {
  if (window.utools?.dbStorage) {
    return window.utools.dbStorage.getItem(key);
  }

  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function storageRemove(key) {
  if (window.utools?.dbStorage) {
    window.utools.dbStorage.removeItem(key);
    return;
  }

  localStorage.removeItem(key);
}

function storageSet(value) {
  if (window.utools?.dbStorage) {
    window.utools.dbStorage.setItem(STORAGE_KEY, value);
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function loadState() {
  try {
    const saved = storageRead(STORAGE_KEY);
    if (saved) {
      const decoded = decodeState(saved);
      const active = pruneExpiredAdjustments(decoded.adjustments, toLocalDateKey(new Date()));
      if (active.length !== decoded.adjustments.length) {
        decoded.adjustments = active;
        storageSet(encodeState(decoded));
      }
      return decoded;
    }
  } catch (error) {
    console.warn('读取假期设置失败', error);
  } finally {
    LEGACY_STORAGE_KEYS.forEach(storageRemove);
  }

  return {
    version: STORAGE_VERSION,
    settings: sanitizeSettings(DEFAULT_SETTINGS),
    appearance: 'system',
    colorSchemeId: 'default',
    customColors: { light: {}, dark: {} },
    holidays: cloneBuiltInHolidays(),
    loadedYears: [2026],
    adjustments: []
  };
}

function persist() {
  storageSet(encodeState(state));
}

async function loadBuiltInColorSchemes() {
  let entries;
  if (window.readBuiltInColorSchemes) {
    entries = window.readBuiltInColorSchemes();
  } else {
    const indexResponse = await fetch(new URL('../themes/index.json', import.meta.url));
    if (!indexResponse.ok) {
      throw new Error('配色方案清单读取失败');
    }
    const { files } = await indexResponse.json();
    if (!Array.isArray(files) || files.some((file) => !/^[a-z0-9][a-z0-9-]*\.json$/.test(file))) {
      throw new Error('配色方案清单无效');
    }
    entries = await Promise.all(files.map(async (id) => {
      const response = await fetch(new URL('../themes/' + id, import.meta.url));
      if (!response.ok) {
        throw new Error('配色方案读取失败：' + id);
      }
      return { id, ...await response.json() };
    }));
  }

  for (const { id, name, light, dark } of entries) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*\.json$/.test(id)
      || typeof name !== 'string' || !name.trim()) {
      throw new Error('内置配色名称或文件名无效');
    }
    const colors = decodeCustomColorsImport({ light, dark });
    if (Object.keys(colors.light).length !== CUSTOM_COLOR_TOKENS.length
      || Object.keys(colors.dark).length !== CUSTOM_COLOR_TOKENS.length) {
      throw new Error('内置配色缺少颜色：' + name);
    }
    builtInColorSchemes.set(id, { name, colors });
  }

  elements.colorScheme.replaceChildren(
    new Option('默认配色', 'default'),
    ...[...builtInColorSchemes].map(([id, scheme]) => new Option(scheme.name, id)),
    new Option('自定义', 'custom')
  );
  if (state.colorSchemeId !== 'default' && state.colorSchemeId !== 'custom'
    && !builtInColorSchemes.has(state.colorSchemeId)) {
    state.colorSchemeId = 'default';
    persist();
  }
  render();
}

function getColorValues(mode) {
  const overrides = state.colorSchemeId === 'custom'
    ? state.customColors[mode] : builtInColorSchemes.get(state.colorSchemeId)?.colors[mode] ?? {};
  return { ...COLOR_DEFAULTS[mode], ...overrides };
}

function applyColors() {
  const root = document.documentElement;
  root.dataset.theme = state.appearance;
  const mode = state.appearance === 'system'
    ? (systemDarkMedia.matches ? 'dark' : 'light') : state.appearance;
  const colors = state.colorSchemeId === 'custom'
    ? state.customColors[mode] : builtInColorSchemes.get(state.colorSchemeId)?.colors[mode] ?? {};
  CUSTOM_COLOR_TOKENS.forEach((token) => {
    if (colors[token]) {
      root.style.setProperty('--' + token, colors[token]);
    } else {
      root.style.removeProperty('--' + token);
    }
  });
  if (colors.primary && !colors['primary-hover']) {
    root.style.setProperty('--primary-hover', colors.primary);
  }
}

function render() {
  applyColors();
  renderSettings();
  renderCalendar();
  renderSummary();
  renderAdjustmentRecords();
  renderYearResult();
  void ensureHolidayData(viewYear);
}

function setView(view) {
  const isSettings = view === 'settings';
  elements.calendarView.hidden = isSettings;
  elements.summaryBand.hidden = isSettings;
  elements.calendarNavigation.hidden = isSettings;
  elements.settingsView.hidden = !isSettings;
  elements.settingsFloatingBack.hidden = true;
}

function renderColorPreview() {
  const colors = getColorValues(colorEditMode);
  CUSTOM_COLOR_TOKENS.forEach((token) => {
    elements.colorPreview.style.setProperty('--preview-' + token, colors[token]);
  });
}

function renderSettings() {
  elements.colorScheme.value = state.colorSchemeId;
  const colors = getColorValues(colorEditMode);
  elements.appearanceMode.querySelectorAll('button[data-value]').forEach((button) => {
    const active = button.dataset.value === state.appearance;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  elements.colorMode.querySelectorAll('button[data-value]').forEach((button) => {
    const active = button.dataset.value === colorEditMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  elements.colorGrid.querySelectorAll('input[data-color-token]').forEach((input) => {
    const color = colors[input.dataset.colorToken];
    const row = input.closest('.color-row');
    input.value = color.slice(0, 7);
    row.querySelector(':scope > output').textContent = color.slice(0, 7).toUpperCase();
    const alpha = row.querySelector('input[data-alpha-token]');
    if (alpha) {
      alpha.value = color.length === 7 ? '0'
        : String(Math.round((1 - parseInt(color.slice(7), 16) / 255) * 100));
      alpha.nextElementSibling.textContent = alpha.value + '%';
    }
  });
  elements.resetCustomColors.disabled = state.colorSchemeId !== 'custom'
    || Object.keys(state.customColors[colorEditMode]).length === 0;
  renderColorPreview();
  elements.weekStartsOn.value = String(state.settings.weekStartsOn);
  elements.anchorMonday.value = state.settings.anchorMonday;

  document.querySelectorAll('.weekend-period-row[data-weekend-day]').forEach((row) => {
    const weekday = row.dataset.weekendDay;
    const rule = state.settings.weekendRules[weekday];
    row.querySelectorAll('.weekend-period-control button').forEach((button) => {
      button.classList.toggle('active', button.dataset.value === rule.restPeriod);
    });
    row.querySelector('.weekend-repeat-interval').value = String(rule.repeatIntervalWeeks);
  });

  const preset = getWeekendPreset();
  document.querySelectorAll('#weekend-preset button').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === preset);
  });

}

function getWeekendPreset() {
  const saturday = state.settings.weekendRules[5];
  const sunday = state.settings.weekendRules[6];
  const isDouble = saturday.restPeriod === 'full'
    && saturday.repeatIntervalWeeks === 0
    && sunday.restPeriod === 'full'
    && sunday.repeatIntervalWeeks === 0;
  if (isDouble) {
    return 'double';
  }

  const isSingle = saturday.restPeriod === 'none'
    && sunday.restPeriod === 'full'
    && sunday.repeatIntervalWeeks === 0;
  if (isSingle) {
    return 'single';
  }

  const isAlternating = saturday.restPeriod === 'full'
    && saturday.repeatIntervalWeeks === 1
    && sunday.restPeriod === 'full'
    && sunday.repeatIntervalWeeks === 0;
  return isAlternating ? 'alternating' : '';
}

function renderCalendar() {
  elements.monthTitle.textContent = `${viewYear}年${viewMonth}月`;
  const weekdayLabels = [
    ...WEEKDAY_LABELS.slice(state.settings.weekStartsOn),
    ...WEEKDAY_LABELS.slice(0, state.settings.weekStartsOn)
  ];
  elements.weekdayHeader.replaceChildren(...weekdayLabels.map((label) => {
    const item = document.createElement('span');
    item.textContent = label;
    return item;
  }));
  elements.calendarGrid.replaceChildren();
  const currentMonthPrefix = `${viewYear}-${String(viewMonth).padStart(2, '0')}-`;
  const todayKey = toLocalDateKey(now);

  buildMonthGrid(viewYear, viewMonth, state.settings.weekStartsOn).forEach((dateKey) => {
    const day = classifyDay(dateKey, state.settings, state.holidays, state.adjustments);
    const consecutiveRest = getConsecutiveRestState(
      dateKey,
      state.settings,
      state.holidays,
      state.adjustments
    );
    const visualCategory = day.visualCategory ?? day.category;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `day-cell ${visualCategory}`;
    button.classList.toggle('has-adjustment', Boolean(day.manualAdjustment));
    button.classList.toggle('has-official-label', day.officialLabels.length > 0);
    button.classList.toggle('official-holiday', day.officialLabels.some((label) => label.endsWith('放假')));
    button.classList.toggle('official-work', day.officialLabels.some((label) => label.endsWith('法定补班')));
    button.classList.toggle('partial-rest', day.restAmount === 0.5);
    button.classList.toggle('consecutive-rest', consecutiveRest.isConsecutive);
    button.classList.toggle(
      'consecutive-rest-start',
      consecutiveRest.isConsecutive && !consecutiveRest.hasPrevious
    );
    button.classList.toggle(
      'consecutive-rest-end',
      consecutiveRest.isConsecutive && !consecutiveRest.hasNext
    );
    button.classList.toggle('outside-month', !dateKey.startsWith(currentMonthPrefix));
    button.classList.toggle('today', dateKey === todayKey);
    button.classList.toggle('selected', dateKey === activeDateKey);
    button.setAttribute('aria-pressed', String(dateKey === activeDateKey));
    button.dataset.date = dateKey;
    const displayName = day.pureLegalAmount > 0 ? day.holiday?.name ?? '' : '';
    const lunarDate = formatLunarDate(dateKey);
    const consecutiveRestText = consecutiveRest.isConsecutive ? ' 连休' : '';
    button.setAttribute(
      'aria-label',
      `${dateKey} 农历${lunarDate} ${displayName} ${getDayPeriodText(day)}${consecutiveRestText}`
    );

    const top = document.createElement('span');
    top.className = 'day-top';
    const dateLabels = document.createElement('span');
    dateLabels.className = 'day-date-labels';
    const number = document.createElement('strong');
    number.className = 'day-number';
    number.textContent = String(Number(dateKey.slice(8)));
    const lunar = document.createElement('small');
    lunar.className = 'day-lunar';
    lunar.textContent = lunarDate;
    const name = document.createElement('span');
    name.className = 'day-name';
    name.textContent = displayName;
    dateLabels.append(name, lunar);
    top.append(number, dateLabels);

    const tags = document.createElement('span');
    tags.className = 'day-tags';

    day.officialLabels.forEach((label) => {
      const officialTag = document.createElement('small');
      const tagType = label === '放假' ? 'holiday' : label === '法定调休' ? 'suggestion' : 'work';
      officialTag.className = `official-tag ${tagType}`;
      officialTag.textContent = label;
      tags.append(officialTag);
    });

    if (tags.childElementCount > 0) {
      top.append(tags);
    }

    const status = document.createElement('span');
    status.className = 'day-period-status';
    const periodItems = canMergeDayPeriods(day)
      ? [['全天', day.periods.am.category]]
      : [['上午', day.periods.am.category], ['下午', day.periods.pm.category]];
    periodItems.forEach(([periodLabel, category]) => {
      const item = document.createElement('small');
      item.className = `period-status-item ${category}`;
      item.textContent = `${periodLabel} ${CATEGORY_LABELS[category]}`;
      status.append(item);
    });
    button.append(top, status);
    elements.calendarGrid.append(button);
  });
}

function canMergeDayPeriods(day) {
  return day.periods.am.category === day.periods.pm.category
    && day.periods.am.sourceCategory === day.periods.pm.sourceCategory
    && day.periods.am.manualAdjustment === day.periods.pm.manualAdjustment;
}

function getDayPeriodText(day) {
  if (canMergeDayPeriods(day)) {
    return `全天 ${CATEGORY_LABELS[day.periods.am.category]}`;
  }

  return `上午 ${CATEGORY_LABELS[day.periods.am.category]} 下午 ${CATEGORY_LABELS[day.periods.pm.category]}`;
}

function formatLunarDate(dateKey) {
  const parts = LUNAR_DATE_FORMATTER.formatToParts(new Date(`${dateKey}T12:00:00`));
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return day === 1 ? month : LUNAR_DAY_LABELS[day - 1] ?? '';
}

function renderSummary() {
  const summary = getMonthSummary(viewYear, viewMonth, state.settings, state.holidays, state.adjustments);
  const adjustmentSummary = getAdjustmentSummary(state.adjustments, state.settings, state.holidays);
  elements.summaryRest.textContent = formatDays(summary.totalRest);
  elements.summaryPure.textContent = formatDays(summary.pureLegal);
  elements.summarySchedule.textContent = formatDays(summary.scheduleRest);
  elements.summaryRestBalance.textContent = formatDays(adjustmentSummary.restRemaining);
  elements.summaryWorkBalance.textContent = formatDays(adjustmentSummary.workRemaining);
}

function renderAdjustmentRecords() {
  const monthStart = `${viewYear}-${String(viewMonth).padStart(2, '0')}-01`;
  const nextMonthYear = viewMonth === 12 ? viewYear + 1 : viewYear;
  const nextMonth = viewMonth === 12 ? 1 : viewMonth + 1;
  const nextMonthStart = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const records = state.adjustments.flatMap((operation) => getAdjustmentRanges(operation)
    .filter((range) => range.endDate >= monthStart && range.startDate < nextMonthStart)
    .map((range) => ({ ...range, id: operation.id, note: operation.note, createdAt: operation.createdAt })))
    .sort((left, right) => right.createdAt - left.createdAt);
  elements.adjustmentRecordCount.textContent = `${records.length} 条`;
  elements.adjustmentRecordList.replaceChildren();
  if (records.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '本月暂无调休或补班记录';
    elements.adjustmentRecordList.append(empty);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement('div');
    row.className = `adjustment-row ${record.type}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'adjustment-main';
    edit.dataset.adjustmentId = record.id;
    edit.dataset.adjustmentType = record.type;
    const date = document.createElement('span');
    date.className = 'adjustment-date';
    date.textContent = formatAdjustmentRange(record);
    const type = document.createElement('strong');
    const typeLabel = record.type === 'rest' ? '调休' : '补班';
    type.textContent = record.note ? `${typeLabel} · ${record.note}` : typeLabel;
    const days = document.createElement('small');
    const total = calculateAdjustmentDays(record, state.settings, state.holidays);
    days.textContent = `${formatDays(total)} 天`;
    edit.append(date, type, days);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'adjustment-delete';
    remove.dataset.deleteAdjustmentId = record.id;
    remove.title = '删除整次调班';
    remove.setAttribute('aria-label', '删除整次调班');
    remove.textContent = '×';
    row.append(edit, remove);
    elements.adjustmentRecordList.append(row);
  });
}

function renderYearResult() {
  const breakdown = getYearLegalBreakdown(viewYear, state.settings, state.holidays);
  const todayKey = toLocalDateKey(now);
  const currentHolidays = breakdown.pure.filter((item) => item.dateKey >= todayKey);
  const expiredHolidays = breakdown.pure.filter((item) => item.dateKey < todayKey);
  elements.resultYear.textContent = viewYear;
  elements.yearPureCount.textContent = `${formatDays(sumItemDays(currentHolidays))} 天`;
  renderHolidayList(elements.pureHolidayList, currentHolidays, '本年暂无可用放假');
  elements.expiredHolidaySection.hidden = expiredHolidays.length === 0;
  elements.expiredHolidayCount.textContent = `${formatDays(sumItemDays(expiredHolidays))} 天`;
  renderHolidayList(elements.expiredHolidayList, expiredHolidays, '');

  const fetchState = yearFetchStates.get(viewYear);
  const hasYearData = hasHolidayData(viewYear);
  if (hasYearData) {
    elements.dataStatus.textContent = `已载入 ${viewYear} 年节假日数据`;
  } else if (fetchState?.status === 'loading') {
    elements.dataStatus.textContent = `正在获取 ${viewYear} 年节假日数据`;
  } else if (fetchState?.status === 'error') {
    elements.dataStatus.textContent = `${viewYear} 年数据暂不可用`;
  } else {
    elements.dataStatus.textContent = `正在检查 ${viewYear} 年节假日数据`;
  }
}

function hasHolidayData(year) {
  return Object.keys(state.holidays).some((dateKey) => dateKey.startsWith(`${year}-`));
}

async function ensureHolidayData(year) {
  if (state.loadedYears.includes(year) && hasHolidayData(year)) {
    return;
  }

  const fetchState = yearFetchStates.get(year);
  if (fetchState?.status === 'loading' || fetchState?.status === 'error') {
    return;
  }

  yearFetchStates.set(year, { status: 'loading' });
  if (viewYear === year) {
    elements.dataStatus.textContent = `正在获取 ${year} 年节假日数据`;
  }

  try {
    const fetchedHolidays = await fetchHolidayYear(year);
    state.holidays = { ...fetchedHolidays, ...state.holidays };
    state.loadedYears = sanitizeLoadedYears([...state.loadedYears, year]);
    yearFetchStates.set(year, { status: 'loaded' });
    persist();
    if (viewYear === year) {
      render();
      showToast(`${year} 年节假日数据已更新`);
    }
  } catch (error) {
    yearFetchStates.set(year, { status: 'error', message: error.message });
    if (viewYear === year) {
      renderYearResult();
    }
  }
}

function renderHolidayList(container, items, emptyText) {
  container.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  const holidayGroups = new Map();
  items.forEach((item) => {
    const name = item.name || '放假';
    const group = holidayGroups.get(name) ?? [];
    group.push(item);
    holidayGroups.set(name, group);
  });

  holidayGroups.forEach((group, name) => {
    const sortedItems = [...group].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
    const firstItem = sortedItems[0];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'holiday-row';
    row.dataset.date = firstItem.dateKey;
    const date = document.createElement('span');
    date.className = 'holiday-date';
    date.textContent = formatHolidayDates(sortedItems);
    const holidayName = document.createElement('strong');
    holidayName.textContent = name;
    const week = document.createElement('small');
    week.textContent = `${formatDays(sumItemDays(sortedItems))} 天`;
    row.append(date, holidayName, week);
    container.append(row);
  });
}

function sumItemDays(items) {
  return items.reduce((total, item) => total + item.days, 0);
}

function readRangeRow(row, type) {
  const fields = Object.fromEntries([...row.querySelectorAll('[data-range-field]')]
    .map((input) => [input.dataset.rangeField, input.value]));
  return { type, ...fields };
}

function appendRange(container, range = null) {
  const row = elements.rangeTemplate.content.firstElementChild.cloneNode(true);
  rangeSequence += 1;
  row.querySelectorAll('[data-range-field]').forEach((input) => {
    const field = input.dataset.rangeField;
    input.id = `adjustment-range-${rangeSequence}-${field}`;
    input.previousElementSibling.htmlFor = input.id;
    input.value = range?.[field] ?? (input.tagName === 'SELECT' ? 'am' : '');
  });
  container.append(row);
  return row;
}

function openAdjustmentDialog(type, record = null, dateKey = '', defaultPeriods = null) {
  selectedAdjustmentId = record?.id ?? '';
  editingAdjustmentId = selectedAdjustmentId;
  selectedAdjustmentDateKey = dateKey || getAdjustmentRanges(record)[0]?.startDate || toLocalDateKey(now);
  selectedAdjustmentType = type === 'correction' ? 'correction' : 'adjustment';
  activeAdjustmentRangeType = type === 'work' ? 'work' : type === 'rest' ? 'rest'
    : getAdjustmentRanges(record)[0]?.type ?? 'rest';
  associationType = record?.associationType ?? 'none';
  elements.restRangeList.replaceChildren();
  elements.workRangeList.replaceChildren();
  getAdjustmentRanges(record).forEach((range) => appendRange(
    range.type === 'rest' ? elements.restRangeList : elements.workRangeList, range
  ));
  if (!record && selectedAdjustmentType !== 'correction') {
    const defaultDate = dateKey || toLocalDateKey(now);
    const initialRange = { startDate: defaultDate, startPeriod: defaultPeriods?.start ?? 'am',
      endDate: defaultDate, endPeriod: defaultPeriods?.end ?? 'pm' };
    appendRange(type === 'work' ? elements.workRangeList : elements.restRangeList, initialRange);
  }
  elements.adjustmentNote.value = record?.note ?? '';
  if (selectedAdjustmentType === 'correction') {
    initializeDateCorrection(dateKey || toLocalDateKey(now));
  } else {
    selectedDateKey = '';
  }
  renderAdjustmentType();
  updateActiveDialogPreview();
  elements.adjustmentDialog.showModal();
}

function openNewAdjustmentForDate(dateKey, selectedPeriod = null) {
  const day = classifyDay(dateKey, state.settings, state.holidays, state.adjustments);
  const period = selectedPeriod ?? ['am', 'pm'].find((item) => !day.periods[item].manualAdjustment);
  const type = period ? (day.periods[period].isRest ? 'work' : 'rest') : 'rest';
  const periods = period ? { start: period, end: period } : { start: 'am', end: 'pm' };
  openAdjustmentDialog(type, null, dateKey, periods);
}

function openAdjustmentPicker(dateKey, records, day) {
  elements.adjustmentPicker.dataset.date = dateKey;
  elements.adjustmentPickerTitle.textContent = formatLongDate(dateKey);
  const entries = records.flatMap((operation) => getAdjustmentRanges(operation)
    .filter((range) => range.startDate <= dateKey && range.endDate >= dateKey)
    .map((range) => {
    const record = { ...range, id: operation.id, note: operation.note };
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `adjustment-picker-item ${record.type}`;
    button.dataset.pickAdjustmentId = record.id;
    button.dataset.pickAdjustmentType = record.type;
    const appliedPeriods = ['am', 'pm'].filter((period) => day.periods[period].manualAdjustmentId === record.id
      && day.periods[period].manualAdjustment === record.type);
    let periods = appliedPeriods;
    if (periods.length === 0) {
      periods = ['am', 'pm'].filter((period) => !(dateKey === record.startDate
        && period === 'am' && record.startPeriod === 'pm')
        && !(dateKey === record.endDate && period === 'pm' && record.endPeriod === 'am'));
    }
    const periodLabel = periods.length === 2 ? '全天' : periods[0] === 'am' ? '上午' : '下午';
    const title = document.createElement('strong');
    title.textContent = `${periodLabel} · 编辑调班（${record.type === 'rest' ? '调休' : '补班'}）`;
    const note = document.createElement('span');
    note.textContent = record.note || formatAdjustmentRange(record);
    button.append(title, note);
    return { button, period: periods[0] };
  }));

  ['am', 'pm'].forEach((period) => {
    if (day.periods[period].manualAdjustment) {
      return;
    }

    const type = day.periods[period].isRest ? 'work' : 'rest';
    const draft = {
      type, startDate: dateKey, startPeriod: period, endDate: dateKey, endPeriod: period
    };
    if (calculateAdjustmentDays(draft, state.settings, state.holidays) === 0
      || hasAdjustmentOverlap(draft, state.adjustments, state.settings, state.holidays)) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'adjustment-picker-item available';
    button.dataset.pickPeriod = period;
    const title = document.createElement('strong');
    title.textContent = `${period === 'am' ? '上午' : '下午'} · 发起调班（${type === 'rest' ? '调休' : '补班'}）`;
    const status = document.createElement('span');
    status.textContent = `当前${day.periods[period].isRest ? '休息' : '上班'} · 可调班 0.5 天`;
    button.append(title, status);
    entries.push({ button, period });
  });

  entries.sort((left, right) => left.period.localeCompare(right.period));
  elements.adjustmentPickerList.replaceChildren(...entries.map((entry) => entry.button));
  elements.adjustmentPicker.showModal();
}

function getDefaultAdjustmentForDate(dateKey) {
  const day = classifyDay(dateKey, state.settings, state.holidays, state.adjustments);
  const adjustedPeriod = ['am', 'pm'].find((period) => day.periods[period].manualAdjustment);
  if (adjustedPeriod) {
    const type = day.periods[adjustedPeriod].manualAdjustment;
    const recordId = day.periods[adjustedPeriod].manualAdjustmentId;
    const record = state.adjustments.find((item) => item.id === recordId) ?? null;
    const matchingPeriods = ['am', 'pm'].filter((period) => day.periods[period].manualAdjustment === type);
    return {
      type,
      record,
      periods: { start: matchingPeriods[0], end: matchingPeriods.at(-1) }
    };
  }

  const workingPeriods = ['am', 'pm'].filter((period) => !day.periods[period].isRest);
  if (workingPeriods.length > 0) {
    return {
      type: 'rest',
      periods: { start: workingPeriods[0], end: workingPeriods.at(-1) }
    };
  }

  return { type: 'work', periods: { start: 'am', end: 'pm' } };
}

function renderAdjustmentType() {
  const isCorrection = selectedAdjustmentType === 'correction';
  elements.adjustmentDialogTitle.textContent = isCorrection ? '修正日期'
    : selectedAdjustmentId ? '编辑调班' : '新增调班';
  const day = classifyDay(selectedAdjustmentDateKey, state.settings, state.holidays, state.adjustments);
  elements.newAdjustment.hidden = !selectedAdjustmentId || isCorrection
    || ['am', 'pm'].every((period) => day.periods[period].manualAdjustment);
  elements.adjustmentType.querySelectorAll('button').forEach((button) => {
    const selected = button.dataset.value === selectedAdjustmentType;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  elements.associationControl.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === associationType);
  });
  setDialogFieldsEnabled(elements.adjustmentFields, !isCorrection);
  setDialogFieldsEnabled(elements.correctionFields, isCorrection);
  const primarySection = activeAdjustmentRangeType === 'work'
    ? elements.workRangeSection : elements.restRangeSection;
  const counterpartSection = activeAdjustmentRangeType === 'work'
    ? elements.restRangeSection : elements.workRangeSection;
  counterpartSection.before(primarySection);
  setDialogFieldsEnabled(primarySection, !isCorrection);
  setDialogFieldsEnabled(counterpartSection, !isCorrection && associationType === 'required');
}

function setDialogFieldsEnabled(container, enabled) {
  container.hidden = !enabled;
  container.querySelectorAll('input, select, textarea').forEach((field) => {
    field.disabled = !enabled;
  });
}

function updateActiveDialogPreview() {
  if (selectedAdjustmentType === 'correction') {
    updateDatePreview();
    return;
  }
  updateAdjustmentPreview();
}

function getAdjustmentDraft() {
  const restRanges = [...elements.restRangeList.children].map((row) => readRangeRow(row, 'rest'));
  const workRanges = [...elements.workRangeList.children].map((row) => readRangeRow(row, 'work'));
  return {
    id: selectedAdjustmentId,
    associationType,
    ranges: associationType === 'none'
      ? activeAdjustmentRangeType === 'work' ? workRanges : restRanges
      : [...restRanges, ...workRanges],
    note: elements.adjustmentNote.value.trim()
  };
}

function hasValidAdjustmentRange(range) {
  if (!range.startDate || !range.endDate || range.endDate < range.startDate) {
    return false;
  }
  return range.startDate !== range.endDate
    || range.startPeriod === 'am'
    || range.endPeriod === 'pm';
}

function getAdjustmentValidation(record) {
  if (record.ranges.length === 0) {
    return '至少添加一个调休或补班日期';
  }
  if (record.ranges.some((range) => !hasValidAdjustmentRange(range))) {
    return '结束时间不能早于开始时间，且每个范围都需填日期';
  }
  if (hasAdjustmentOverlap(record, [record], state.settings, state.holidays)) {
    return '本次调班有重复的半天';
  }
  if (record.associationType === 'none'
    && hasAdjustmentOverlap(record, state.adjustments, state.settings, state.holidays)) {
    return '所选范围包含已调班时段';
  }
  if (record.ranges.some((range) => calculateAdjustmentDays(range, state.settings, state.holidays) === 0)) {
    return '有日期范围不包含可调班的半天';
  }
  return '';
}

function updateAdjustmentPreview() {
  const record = getAdjustmentDraft();
  const error = getAdjustmentValidation(record);
  if (error) {
    elements.adjustmentPreview.textContent = error;
    elements.adjustmentPreview.classList.add('invalid');
    return;
  }
  const summary = getAdjustmentSummary([record], state.settings, state.holidays);
  elements.adjustmentPreview.textContent = `本次调休 ${formatDays(summary.restTotal)} 天 · 补班 ${formatDays(summary.workTotal)} 天${record.associationType === 'required' && (!summary.restTotal || !summary.workTotal) ? ' · 关联日期可后续补充' : ''}`;
  elements.adjustmentPreview.classList.remove('invalid');
}

function saveAdjustmentRecord() {
  const draft = getAdjustmentDraft();
  const error = getAdjustmentValidation(draft);
  if (error) {
    showToast(error, true);
    return false;
  }
  const existing = state.adjustments.find((record) => record.id === selectedAdjustmentId);
  const detachedRanges = draft.associationType === 'none'
    ? getAdjustmentRanges(existing).filter((range) => range.type !== activeAdjustmentRangeType) : [];
  const detached = detachedRanges.length ? {
    ...existing, id: createAdjustmentId(), associationType: 'none', ranges: detachedRanges
  } : null;
  const record = {
    ...draft,
    id: selectedAdjustmentId || createAdjustmentId(),
    createdAt: existing?.createdAt ?? Date.now()
  };
  const original = state.adjustments.filter((item) => item.id !== selectedAdjustmentId);
  const reconciliation = record.associationType === 'required'
    ? mergeAssociatedAdjustment(record, original, state.settings, state.holidays)
    : { mergedIds: [], remaining: [] };
  const remaining = reconciliation.remaining.map((item) => ({
    ...item, id: createAdjustmentId()
  }));
  state.adjustments = sanitizeAdjustmentRecords([
    ...original.filter((item) => !reconciliation.mergedIds.includes(item.id)),
    ...remaining, ...(detached ? [detached] : []), record
  ]);
  persist();
  render();
  showToast('调班操作已保存');
  return true;
}

function createAdjustmentId() {
  return window.crypto?.randomUUID?.() ?? `adjustment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function initializeDateCorrection(dateKey) {
  selectedDateKey = dateKey;
  const record = state.holidays[dateKey];
  const resolvedDay = classifyDay(dateKey, state.settings, state.holidays);
  const sourceCategories = Object.values(resolvedDay.periods).map((period) => period.sourceCategory);
  elements.editDate.value = dateKey;
  elements.editKind.value = record?.kind === 'block'
    ? sourceCategories.includes('pure-legal')
      ? 'legal'
      : sourceCategories.includes('adjusted-work')
        ? 'work'
        : sourceCategories.includes('makeup-off')
          ? 'off'
          : ''
    : record?.kind ?? '';
  elements.editName.value = record?.kind === 'block' ? resolvedDay.holiday?.name ?? '' : record?.name ?? '';
}

function updateDatePreview() {
  const dateKey = elements.editDate.value;
  if (!dateKey) {
    return;
  }

  const previewHolidays = { ...state.holidays };
  const kind = elements.editKind.value;
  if (kind) {
    previewHolidays[dateKey] = { kind, name: elements.editName.value };
  } else {
    delete previewHolidays[dateKey];
  }

  const day = classifyDay(dateKey, state.settings, previewHolidays);
  elements.datePreview.textContent = `${formatLongDate(dateKey)} · ${getDayPeriodText(day)}`;
}

function saveDateEdit() {
  const dateKey = elements.editDate.value;
  const kind = elements.editKind.value;

  if (selectedDateKey && selectedDateKey !== dateKey) {
    delete state.holidays[selectedDateKey];
  }

  if (kind) {
    state.holidays[dateKey] = { kind, name: elements.editName.value.trim() };
  } else {
    delete state.holidays[dateKey];
  }

  persist();
  render();
  showToast('日期安排已保存');
}

function moveMonth(offset) {
  const date = new Date(Date.UTC(viewYear, viewMonth - 1 + offset, 1));
  viewYear = date.getUTCFullYear();
  viewMonth = date.getUTCMonth() + 1;
  render();
}

function exportData() {
  const content = JSON.stringify(encodeState(state), null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `假期安排-${viewYear}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出');
}

async function importCustomColors(file) {
  try {
    const imported = JSON.parse(await file.text());
    const colors = decodeCustomColorsImport(imported);
    state.customColors = colors;
    state.colorSchemeId = 'custom';
    persist();
    applyColors();
    renderSettings();
    showToast('配色方案已导入');
  } catch (error) {
    showToast(error.message || '配色导入失败', true);
  } finally {
    elements.colorImportFile.value = '';
  }
}

async function importData(file) {
  try {
    const imported = JSON.parse(await file.text());
    state = decodeState(imported);
    if (state.colorSchemeId !== 'default' && state.colorSchemeId !== 'custom'
      && !builtInColorSchemes.has(state.colorSchemeId)) {
      state.colorSchemeId = 'default';
    }
    state.adjustments = pruneExpiredAdjustments(state.adjustments, toLocalDateKey(new Date()));
    persist();
    render();
    showToast('数据已导入');
  } catch (error) {
    showToast(error.message || '导入失败', true);
  } finally {
    elements.importFile.value = '';
  }
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.add('visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2200);
}

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDays(days) {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

function formatAdjustmentRange(record) {
  const periodLabels = { am: '上午', pm: '下午' };
  const formatDate = (dateKey) => {
    const [year, month, day] = dateKey.split('-');
    return `${year}/${Number(month)}/${Number(day)}`;
  };
  if (record.startDate === record.endDate) {
    const period = record.startPeriod === 'am' && record.endPeriod === 'pm'
      ? '全天'
      : periodLabels[record.startPeriod];
    return `${formatDate(record.startDate)} ${period}`;
  }

  return `${formatDate(record.startDate)} ${periodLabels[record.startPeriod]} - ${formatDate(record.endDate)} ${periodLabels[record.endPeriod]}`;
}

function formatHolidayDates(items) {
  let previousMonth = '';
  return items.map((item) => {
    const [, month, day] = item.dateKey.split('-');
    const monthLabel = month === previousMonth ? '' : `${Number(month)}月`;
    previousMonth = month;
    return `${monthLabel}${Number(day)}日`;
  }).join('、');
}

function formatLongDate(dateKey) {
  const [year, month, day] = dateKey.split('-');
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

document.querySelector('#calendar-prev-month').addEventListener('click', () => moveMonth(-1));
document.querySelector('#calendar-next-month').addEventListener('click', () => moveMonth(1));
document.querySelector('#today-button').addEventListener('click', () => {
  activeDateKey = toLocalDateKey(now);
  viewYear = now.getFullYear();
  viewMonth = now.getMonth() + 1;
  render();
});
elements.settingsToggle.addEventListener('click', () => {
  setView('settings');
  elements.settingsBack.focus();
});

function returnToCalendar() {
  setView('calendar');
  elements.settingsToggle.focus();
}

elements.settingsBack.addEventListener('click', returnToCalendar);
elements.settingsFloatingBack.addEventListener('click', returnToCalendar);

const settingsBackObserver = new IntersectionObserver(([entry]) => {
  elements.settingsFloatingBack.hidden = elements.settingsView.hidden || entry.isIntersecting;
});
settingsBackObserver.observe(elements.settingsBack);

elements.calendarGrid.addEventListener('click', (event) => {
  const day = event.target.closest('.day-cell');
  if (!day || event.button !== 0) {
    return;
  }

  const dateKey = day.dataset.date;
  activeDateKey = dateKey;
  if (Number(dateKey.slice(0, 4)) !== viewYear || Number(dateKey.slice(5, 7)) !== viewMonth) {
    viewYear = Number(dateKey.slice(0, 4));
    viewMonth = Number(dateKey.slice(5, 7));
    render();
    elements.calendarGrid.querySelector(`[data-date="${dateKey}"]`).focus();
    return;
  }

  const previous = elements.calendarGrid.querySelector('.day-cell.selected');
  if (previous) {
    previous.classList.remove('selected');
    previous.setAttribute('aria-pressed', 'false');
  }
  day.classList.add('selected');
  day.setAttribute('aria-pressed', 'true');
});

elements.calendarGrid.addEventListener('contextmenu', (event) => {
  const day = event.target.closest('.day-cell');
  if (!day) {
    return;
  }
  event.preventDefault();

  const dateKey = day.dataset.date;
  const records = state.adjustments.filter((record) => getAdjustmentRanges(record).some((range) =>
    range.startDate <= dateKey && range.endDate >= dateKey));
  const resolvedDay = classifyDay(dateKey, state.settings, state.holidays, state.adjustments);
  if (records.flatMap(getAdjustmentRanges).filter((range) => range.startDate <= dateKey
    && range.endDate >= dateKey).length > 1 || !canMergeDayPeriods(resolvedDay)) {
    openAdjustmentPicker(dateKey, records, resolvedDay);
  } else {
    const defaults = getDefaultAdjustmentForDate(dateKey);
    openAdjustmentDialog(defaults.type, defaults.record, dateKey, defaults.periods);
  }
});

elements.adjustmentPicker.addEventListener('click', (event) => {
  if (event.target.closest('[data-picker-close]')) {
    elements.adjustmentPicker.close();
    return;
  }

  const dateKey = elements.adjustmentPicker.dataset.date;
  const selected = event.target.closest('[data-pick-adjustment-id]');
  if (selected) {
    const record = state.adjustments.find((item) => item.id === selected.dataset.pickAdjustmentId);
    if (record) {
      elements.adjustmentPicker.close();
      openAdjustmentDialog(selected.dataset.pickAdjustmentType, record, dateKey);
    }
    return;
  }

  const available = event.target.closest('[data-pick-period]');
  if (available) {
    elements.adjustmentPicker.close();
    openNewAdjustmentForDate(dateKey, available.dataset.pickPeriod);
    return;
  }

  if (event.target.closest('#picker-correction')) {
    elements.adjustmentPicker.close();
    openAdjustmentDialog('correction', null, dateKey);
  }
});

elements.calendarView.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-adjustment-id]');
  if (deleteButton) {
    const record = state.adjustments.find((item) => item.id === deleteButton.dataset.deleteAdjustmentId);
    if (record && window.confirm('这会删除整次调班中的全部调休与补班日期，继续吗？')) {
      state.adjustments = state.adjustments.filter((item) => item.id !== record.id);
      persist();
      render();
      showToast('整次调班已删除');
    }
    return;
  }

  const adjustmentButton = event.target.closest('[data-adjustment-id]');
  if (adjustmentButton) {
    const record = state.adjustments.find((item) => item.id === adjustmentButton.dataset.adjustmentId);
    if (record) {
      openAdjustmentDialog(adjustmentButton.dataset.adjustmentType, record);
    }
    return;
  }

  const row = event.target.closest('.holiday-row');
  if (row) {
    const [year, month] = row.dataset.date.split('-').map(Number);
    viewYear = year;
    viewMonth = month;
    render();
    const defaults = getDefaultAdjustmentForDate(row.dataset.date);
    openAdjustmentDialog(defaults.type, null, row.dataset.date, defaults.periods);
  }
});

elements.anchorMonday.addEventListener('change', () => {
  if (!elements.anchorMonday.value) {
    renderSettings();
    return;
  }

  state.settings.anchorMonday = startOfWeek(elements.anchorMonday.value);
  persist();
  render();
});

elements.weekStartsOn.addEventListener('change', () => {
  state.settings.weekStartsOn = Number(elements.weekStartsOn.value);
  persist();
  render();
});

elements.appearanceMode.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-value]');
  if (!button || button.dataset.value === state.appearance) {
    return;
  }

  state.appearance = button.dataset.value;
  applyColors();
  persist();
  renderSettings();
});

elements.colorScheme.addEventListener('change', () => {
  const id = elements.colorScheme.value;
  if (id !== 'default' && id !== 'custom' && !builtInColorSchemes.has(id)) {
    return;
  }
  state.colorSchemeId = id;
  persist();
  applyColors();
  renderSettings();
});

systemDarkMedia.addEventListener('change', applyColors);

elements.colorMode.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-value]');
  if (!button || button.dataset.value === colorEditMode) {
    return;
  }
  colorEditMode = button.dataset.value;
  renderSettings();
});

elements.colorGrid.addEventListener('input', (event) => {
  const control = event.target.closest('input[data-color-token], input[data-alpha-token]');
  if (!control) {
    return;
  }
  if (state.colorSchemeId !== 'custom') {
    const scheme = builtInColorSchemes.get(state.colorSchemeId)?.colors;
    state.customColors = scheme
      ? { light: { ...scheme.light }, dark: { ...scheme.dark } }
      : { light: {}, dark: {} };
    state.colorSchemeId = 'custom';
    elements.colorScheme.value = 'custom';
  }
  const row = control.closest('.color-row');
  const input = row.querySelector('input[data-color-token]');
  const token = input.dataset.colorToken;
  const alpha = row.querySelector('input[data-alpha-token]');
  const color = input.value + (alpha
    ? Math.round((100 - Number(alpha.value)) / 100 * 255).toString(16).padStart(2, '0') : '');
  const defaultColor = COLOR_DEFAULTS[colorEditMode][token];
  if (color === defaultColor || (defaultColor.length === 7 && color === defaultColor + 'ff')) {
    delete state.customColors[colorEditMode][token];
  } else {
    state.customColors[colorEditMode][token] = color;
  }
  row.querySelector(':scope > output').textContent = input.value.toUpperCase();
  if (alpha) {
    alpha.nextElementSibling.textContent = alpha.value + '%';
  }
  elements.resetCustomColors.disabled = Object.keys(state.customColors[colorEditMode]).length === 0;
  renderColorPreview();
  applyColors();
});
elements.colorGrid.addEventListener('change', persist);

document.querySelector('#import-custom-colors').addEventListener('click', () => elements.colorImportFile.click());
elements.colorImportFile.addEventListener('change', () => {
  const [file] = elements.colorImportFile.files;
  if (file) {
    void importCustomColors(file);
  }
});

elements.resetCustomColors.addEventListener('click', () => {
  state.customColors[colorEditMode] = {};
  persist();
  applyColors();
  renderSettings();
});

document.querySelector('#weekend-preset').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-value]');
  const preset = WEEKEND_PRESETS[button?.dataset.value];
  if (!preset) {
    return;
  }

  state.settings.weekendRules = {
    5: { ...preset[5] },
    6: { ...preset[6] }
  };
  persist();
  render();
});

document.querySelector('.settings-panel').addEventListener('click', (event) => {
  const button = event.target.closest('.weekend-period-control button[data-value]');
  if (!button) {
    return;
  }

  const row = button.closest('.weekend-period-row');
  const weekday = row.dataset.weekendDay;
  state.settings.weekendRules[weekday].restPeriod = button.dataset.value;
  persist();
  render();
});

document.querySelector('.settings-panel').addEventListener('change', (event) => {
  const input = event.target.closest('.weekend-repeat-interval');
  if (!input) {
    return;
  }

  const row = input.closest('.weekend-period-row');
  const weekday = row.dataset.weekendDay;
  const interval = Math.min(52, Math.max(0, Math.round(Number(input.value) || 0)));
  state.settings.weekendRules[weekday].repeatIntervalWeeks = interval;
  persist();
  render();
});

document.querySelector('#import-data').addEventListener('click', () => elements.importFile.click());
elements.importFile.addEventListener('change', () => {
  const [file] = elements.importFile.files;
  if (file) {
    importData(file);
  }
});
document.querySelector('#export-data').addEventListener('click', exportData);
document.querySelector('#reset-data').addEventListener('click', () => {
  if (!window.confirm('恢复内置数据会覆盖当前节假日修改，继续吗？')) {
    return;
  }

  state.holidays = Object.fromEntries(
    Object.entries(state.holidays).filter(([dateKey]) => !dateKey.startsWith('2026-'))
  );
  state.holidays = { ...state.holidays, ...cloneBuiltInHolidays() };
  state.loadedYears = sanitizeLoadedYears([...state.loadedYears, 2026]);
  persist();
  render();
  showToast('已恢复内置 2026 数据');
});

document.addEventListener('click', (event) => {
  const input = event.target.closest('input[type="date"]');
  if (!input || input.disabled || typeof input.showPicker !== 'function') {
    return;
  }
  try {
    input.showPicker();
  } catch {
    // The host may restrict native pickers; date text entry remains available.
  }
});

elements.editDate.addEventListener('change', updateDatePreview);
elements.editKind.addEventListener('change', updateDatePreview);
elements.editName.addEventListener('input', updateDatePreview);
elements.newAdjustment.addEventListener('click', () => {
  elements.adjustmentDialog.close();
  openNewAdjustmentForDate(selectedAdjustmentDateKey);
});
elements.adjustmentType.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-value]');
  if (!button || button.dataset.value === selectedAdjustmentType) {
    return;
  }
  if (button.dataset.value === 'correction') {
    selectedAdjustmentId = '';
    if (!selectedDateKey) {
      initializeDateCorrection(
        elements.adjustmentForm.querySelector('[data-range-field="startDate"]')?.value
          || selectedAdjustmentDateKey
      );
    }
  } else {
    selectedAdjustmentId = editingAdjustmentId;
  }
  selectedAdjustmentType = button.dataset.value;
  renderAdjustmentType();
  updateActiveDialogPreview();
});
elements.adjustmentType.addEventListener('keydown', (event) => {
  const tabs = [...elements.adjustmentType.querySelectorAll('[role="tab"]')];
  const active = tabs.findIndex((tab) => tab.dataset.value === selectedAdjustmentType);
  let next = active;
  if (event.key === 'ArrowRight') {
    next = (active + 1) % tabs.length;
  } else if (event.key === 'ArrowLeft') {
    next = (active - 1 + tabs.length) % tabs.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = tabs.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  tabs[next].click();
  tabs[next].focus();
});
elements.associationControl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-value]');
  if (!button) {
    return;
  }
  associationType = button.dataset.value;
  renderAdjustmentType();
  updateAdjustmentPreview();
});
document.querySelector('#add-rest-range').addEventListener('click', () => {
  appendRange(elements.restRangeList);
  updateAdjustmentPreview();
});
document.querySelector('#add-work-range').addEventListener('click', () => {
  appendRange(elements.workRangeList);
  updateAdjustmentPreview();
});
elements.adjustmentFields.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-range]');
  if (button) {
    button.closest('.adjustment-range-row').remove();
    updateAdjustmentPreview();
  }
});
elements.adjustmentFields.addEventListener('change', updateAdjustmentPreview);
elements.adjustmentNote.addEventListener('input', updateAdjustmentPreview);
elements.adjustmentForm.addEventListener('click', (event) => {
  if (event.target.closest('[data-dialog-close]')) {
    elements.adjustmentDialog.close();
  }
});
elements.adjustmentDialog.addEventListener('click', (event) => {
  if (event.target !== elements.adjustmentDialog) {
    return;
  }
  const { left, right, top, bottom } = elements.adjustmentDialog.getBoundingClientRect();
  if (event.clientX < left || event.clientX >= right
    || event.clientY < top || event.clientY >= bottom) {
    elements.adjustmentDialog.close();
  }
});
elements.adjustmentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (selectedAdjustmentType === 'correction') {
    saveDateEdit();
    elements.adjustmentDialog.close();
    return;
  }

  if (saveAdjustmentRecord()) {
    elements.adjustmentDialog.close();
  }
});

window.utools?.onPluginEnter?.(() => {
  const active = pruneExpiredAdjustments(state.adjustments, toLocalDateKey(new Date()));
  if (active.length !== state.adjustments.length) {
    state.adjustments = active;
    persist();
  }
  viewYear = new Date().getFullYear();
  viewMonth = new Date().getMonth() + 1;
  setView('calendar');
  render();
});

window.addEventListener('online', () => {
  if (yearFetchStates.get(viewYear)?.status === 'error') {
    yearFetchStates.delete(viewYear);
    void ensureHolidayData(viewYear);
  }
});

setView('calendar');
render();
void loadBuiltInColorSchemes().catch((error) => {
  console.error('内置配色读取失败', error);
  showToast('内置配色读取失败', true);
});
