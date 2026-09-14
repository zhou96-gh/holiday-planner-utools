import { BUILT_IN_HOLIDAYS } from './holiday/data.js';
import { fetchHolidayYear } from './holiday/fetch.js';
import {
  DEFAULT_SETTINGS,
  buildMonthGrid,
  calculateAdjustmentDays,
  classifyDay,
  getAdjustmentSummary,
  getMonthSummary,
  getYearLegalBreakdown,
  sanitizeAdjustmentRecords,
  sanitizeHolidays,
  sanitizeSettings,
  startOfWeek
} from './holiday/core.js';

const STORAGE_KEY = 'holiday-planner-state-v5';
const LEGACY_STORAGE_KEYS = ['holiday-planner-state-v4', 'holiday-planner-state-v3'];
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

const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth() + 1;
let selectedDateKey = '';
let selectedAdjustmentId = '';
let selectedAdjustmentType = 'rest';
let toastTimer = null;
let state = loadState();
let activeView = 'calendar';
const yearFetchStates = new Map();

const elements = {
  monthTitle: document.querySelector('#month-title'),
  calendarNavigation: document.querySelector('#calendar-navigation'),
  calendarView: document.querySelector('#calendar-view'),
  settingsView: document.querySelector('#settings-view'),
  summaryBand: document.querySelector('#summary-band'),
  addDate: document.querySelector('#add-date'),
  addAdjustment: document.querySelector('#add-adjustment'),
  settingsToggle: document.querySelector('#settings-toggle'),
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
  dialog: document.querySelector('#date-dialog'),
  dateForm: document.querySelector('#date-form'),
  editDate: document.querySelector('#edit-date'),
  editKind: document.querySelector('#edit-kind'),
  editName: document.querySelector('#edit-name'),
  dialogDateTitle: document.querySelector('#dialog-date-title'),
  datePreview: document.querySelector('#date-preview'),
  adjustmentDialog: document.querySelector('#adjustment-dialog'),
  adjustmentForm: document.querySelector('#adjustment-form'),
  adjustmentDialogTitle: document.querySelector('#adjustment-dialog-title'),
  adjustmentType: document.querySelector('#adjustment-type'),
  adjustmentStartDate: document.querySelector('#adjustment-start-date'),
  adjustmentStartPeriod: document.querySelector('#adjustment-start-period'),
  adjustmentEndDate: document.querySelector('#adjustment-end-date'),
  adjustmentEndPeriod: document.querySelector('#adjustment-end-period'),
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

function storageGet() {
  return [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]
    .map((key) => storageRead(key))
    .find((value) => value != null) ?? null;
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
    const saved = storageGet();
    if ([3, 4, 5].includes(saved?.version)) {
      return {
        version: 5,
        settings: sanitizeSettings(saved.settings),
        holidays: sanitizeHolidays(saved.holidays),
        loadedYears: sanitizeLoadedYears(saved.loadedYears ?? [2026]),
        adjustments: sanitizeAdjustmentRecords(saved.adjustments)
      };
    }
  } catch (error) {
    console.warn('读取假期设置失败', error);
  }

  return {
    version: 5,
    settings: sanitizeSettings(DEFAULT_SETTINGS),
    holidays: cloneBuiltInHolidays(),
    loadedYears: [2026],
    adjustments: []
  };
}

function sanitizeLoadedYears(years) {
  if (!Array.isArray(years)) {
    return [];
  }

  return [...new Set(years.filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2200))].sort();
}

function persist() {
  storageSet(state);
}

function render() {
  renderSettings();
  renderCalendar();
  renderSummary();
  renderAdjustmentRecords();
  renderYearResult();
  void ensureHolidayData(viewYear);
}

function setView(view) {
  activeView = view;
  const isSettings = view === 'settings';
  elements.calendarView.hidden = isSettings;
  elements.summaryBand.hidden = isSettings;
  elements.calendarNavigation.hidden = isSettings;
  elements.addDate.hidden = isSettings;
  elements.addAdjustment.hidden = isSettings;
  elements.settingsView.hidden = !isSettings;
  elements.settingsToggle.textContent = isSettings ? '返回日历' : '设置';
  elements.settingsToggle.setAttribute('aria-expanded', String(isSettings));
}

function renderSettings() {
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
  elements.monthTitle.textContent = `${viewYear} 年 ${viewMonth} 月`;
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
    const visualCategory = day.visualCategory ?? day.category;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `day-cell ${visualCategory}`;
    button.classList.toggle('has-adjustment', Boolean(day.manualAdjustment));
    button.classList.toggle('official-holiday', day.officialLabels.some((label) => label.endsWith('放假')));
    button.classList.toggle('official-work', day.officialLabels.some((label) => label.endsWith('法定补班')));
    button.classList.toggle('partial-rest', day.restAmount === 0.5);
    button.classList.toggle('outside-month', !dateKey.startsWith(currentMonthPrefix));
    button.classList.toggle('today', dateKey === todayKey);
    button.dataset.date = dateKey;
    const displayName = day.pureLegalAmount > 0 ? day.holiday?.name ?? '' : '';
    const lunarDate = formatLunarDate(dateKey);
    button.setAttribute('aria-label', `${dateKey} 农历${lunarDate} ${displayName} ${getDayPeriodText(day)}`);

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
    dateLabels.append(number, lunar);
    top.append(dateLabels);

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

    const name = document.createElement('span');
    name.className = 'day-name';
    name.textContent = displayName;
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
    button.append(top, name, status);
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
  const records = state.adjustments
    .filter((record) => record.endDate >= monthStart && record.startDate < nextMonthStart)
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
    const date = document.createElement('span');
    date.className = 'adjustment-date';
    date.textContent = formatAdjustmentRange(record);
    const type = document.createElement('strong');
    type.textContent = record.note || (record.type === 'rest' ? '调休' : '补班');
    const days = document.createElement('small');
    const total = calculateAdjustmentDays(record, state.settings, state.holidays);
    days.textContent = `${formatDays(total)} 天`;
    edit.append(date, type, days);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'adjustment-delete';
    remove.dataset.deleteAdjustmentId = record.id;
    remove.title = '删除记录';
    remove.setAttribute('aria-label', `删除${record.type === 'rest' ? '调休' : '补班'}记录`);
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

function openAdjustmentDialog(type, record = null) {
  selectedAdjustmentId = record?.id ?? '';
  selectedAdjustmentType = record?.type ?? type;
  const defaultDate = toLocalDateKey(now);
  elements.adjustmentStartDate.value = record?.startDate ?? defaultDate;
  elements.adjustmentStartPeriod.value = record?.startPeriod ?? 'am';
  elements.adjustmentEndDate.value = record?.endDate ?? defaultDate;
  elements.adjustmentEndPeriod.value = record?.endPeriod ?? 'am';
  elements.adjustmentNote.value = record?.note ?? '';
  renderAdjustmentType();
  updateAdjustmentPreview();
  elements.adjustmentDialog.showModal();
}

function renderAdjustmentType() {
  elements.adjustmentDialogTitle.textContent = selectedAdjustmentId
    ? `编辑${selectedAdjustmentType === 'rest' ? '调休' : '补班'}`
    : `发起${selectedAdjustmentType === 'rest' ? '调休' : '补班'}`;
  elements.adjustmentType.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === selectedAdjustmentType);
  });
}

function getAdjustmentDraft() {
  return {
    id: selectedAdjustmentId,
    type: selectedAdjustmentType,
    startDate: elements.adjustmentStartDate.value,
    startPeriod: elements.adjustmentStartPeriod.value,
    endDate: elements.adjustmentEndDate.value,
    endPeriod: elements.adjustmentEndPeriod.value,
    note: elements.adjustmentNote.value.trim()
  };
}

function hasValidAdjustmentRange(record) {
  if (!record.startDate || !record.endDate || record.endDate < record.startDate) {
    return false;
  }

  return record.startDate !== record.endDate
    || record.startPeriod === 'am'
    || record.endPeriod === 'pm';
}

function updateAdjustmentPreview() {
  const record = getAdjustmentDraft();
  if (!hasValidAdjustmentRange(record)) {
    elements.adjustmentPreview.textContent = '结束时间不能早于开始时间';
    elements.adjustmentPreview.classList.add('invalid');
    return;
  }

  const days = calculateAdjustmentDays(record, state.settings, state.holidays);
  const rule = record.type === 'rest' ? '仅累计原本上班的时段' : '仅累计原本休息的时段';
  elements.adjustmentPreview.textContent = `${rule} · 本次 ${formatDays(days)} 天`;
  elements.adjustmentPreview.classList.toggle('invalid', days === 0);
}

function saveAdjustmentRecord() {
  const draft = getAdjustmentDraft();
  const days = calculateAdjustmentDays(draft, state.settings, state.holidays);
  if (!hasValidAdjustmentRange(draft) || days === 0) {
    showToast('所选范围内没有可记录的半天', true);
    return false;
  }

  const existing = state.adjustments.find((record) => record.id === selectedAdjustmentId);
  const record = {
    ...draft,
    id: selectedAdjustmentId || createAdjustmentId(),
    createdAt: existing?.createdAt ?? Date.now()
  };
  state.adjustments = sanitizeAdjustmentRecords([
    ...state.adjustments.filter((item) => item.id !== selectedAdjustmentId),
    record
  ]);
  persist();
  render();
  showToast(`${record.type === 'rest' ? '调休' : '补班'}记录已保存`);
  return true;
}

function createAdjustmentId() {
  return window.crypto?.randomUUID?.() ?? `adjustment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function openDateDialog(dateKey) {
  selectedDateKey = dateKey;
  const record = state.holidays[dateKey];
  const resolvedDay = classifyDay(dateKey, state.settings, state.holidays);
  elements.editDate.value = dateKey;
  elements.editKind.value = record?.kind === 'block'
    ? ({ 'pure-legal': 'legal', 'makeup-off': 'off', 'adjusted-work': 'work' }[resolvedDay.category] ?? '')
    : record?.kind ?? '';
  elements.editName.value = record?.kind === 'block' ? resolvedDay.holiday?.name ?? '' : record?.name ?? '';
  updateDatePreview();
  elements.dialog.showModal();
}

function updateDatePreview() {
  const dateKey = elements.editDate.value;
  if (!dateKey) {
    return;
  }

  elements.dialogDateTitle.textContent = formatLongDate(dateKey);
  const previewHolidays = { ...state.holidays };
  const kind = elements.editKind.value;
  if (kind) {
    previewHolidays[dateKey] = { kind, name: elements.editName.value };
  } else {
    delete previewHolidays[dateKey];
  }

  const day = classifyDay(dateKey, state.settings, previewHolidays);
  elements.datePreview.textContent = getDayPeriodText(day);
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
  const content = JSON.stringify(state, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `假期安排-${viewYear}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出');
}

async function importData(file) {
  try {
    const imported = JSON.parse(await file.text());
    if (![3, 4, 5].includes(imported?.version)) {
      throw new Error('不支持的数据版本');
    }

    state = {
      version: 5,
      settings: sanitizeSettings(imported.settings),
      holidays: sanitizeHolidays(imported.holidays),
      loadedYears: sanitizeLoadedYears(imported.loadedYears ?? [2026]),
      adjustments: sanitizeAdjustmentRecords(imported.adjustments)
    };
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

document.querySelector('#prev-month').addEventListener('click', () => moveMonth(-1));
document.querySelector('#next-month').addEventListener('click', () => moveMonth(1));
document.querySelector('#calendar-prev-month').addEventListener('click', () => moveMonth(-1));
document.querySelector('#calendar-next-month').addEventListener('click', () => moveMonth(1));
document.querySelector('#today-button').addEventListener('click', () => {
  viewYear = now.getFullYear();
  viewMonth = now.getMonth() + 1;
  render();
});
document.querySelector('#add-date').addEventListener('click', () => {
  openDateDialog(`${viewYear}-${String(viewMonth).padStart(2, '0')}-01`);
});
elements.addAdjustment.addEventListener('click', () => openAdjustmentDialog('rest'));
elements.settingsToggle.addEventListener('click', () => {
  setView(activeView === 'settings' ? 'calendar' : 'settings');
});

elements.calendarGrid.addEventListener('click', (event) => {
  const day = event.target.closest('.day-cell');
  if (day) {
    openDateDialog(day.dataset.date);
  }
});

elements.calendarView.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-adjustment-id]');
  if (deleteButton) {
    const record = state.adjustments.find((item) => item.id === deleteButton.dataset.deleteAdjustmentId);
    if (record) {
      state.adjustments = state.adjustments.filter((item) => item.id !== record.id);
      persist();
      render();
      showToast('记录已删除');
    }
    return;
  }

  const adjustmentButton = event.target.closest('[data-adjustment-id]');
  if (adjustmentButton) {
    const record = state.adjustments.find((item) => item.id === adjustmentButton.dataset.adjustmentId);
    if (record) {
      openAdjustmentDialog(record.type, record);
    }
    return;
  }

  const row = event.target.closest('.holiday-row');
  if (row) {
    const [year, month] = row.dataset.date.split('-').map(Number);
    viewYear = year;
    viewMonth = month;
    render();
    openDateDialog(row.dataset.date);
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

elements.editDate.addEventListener('change', updateDatePreview);
elements.editKind.addEventListener('change', updateDatePreview);
elements.editName.addEventListener('input', updateDatePreview);
elements.dateForm.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') {
    return;
  }

  event.preventDefault();
  saveDateEdit();
  elements.dialog.close();
});

elements.adjustmentType.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-value]');
  if (!button) {
    return;
  }

  selectedAdjustmentType = button.dataset.value;
  renderAdjustmentType();
  updateAdjustmentPreview();
});
[
  elements.adjustmentStartDate,
  elements.adjustmentStartPeriod,
  elements.adjustmentEndDate,
  elements.adjustmentEndPeriod
].forEach((input) => input.addEventListener('change', updateAdjustmentPreview));
elements.adjustmentNote.addEventListener('input', updateAdjustmentPreview);
elements.adjustmentForm.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') {
    return;
  }

  event.preventDefault();
  if (saveAdjustmentRecord()) {
    elements.adjustmentDialog.close();
  }
});

window.utools?.onPluginEnter?.(() => {
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
