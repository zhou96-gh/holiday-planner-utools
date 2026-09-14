import { BUILT_IN_HOLIDAYS } from './holiday/data.js';
import { fetchHolidayYear } from './holiday/fetch.js';
import {
  DEFAULT_SETTINGS,
  buildMonthGrid,
  classifyDay,
  getMonthSummary,
  getWeekType,
  getYearLegalBreakdown,
  sanitizeHolidays,
  sanitizeSettings,
  startOfWeek
} from './holiday/core.js';

const STORAGE_KEY = 'holiday-planner-state-v4';
const LEGACY_STORAGE_KEY = 'holiday-planner-state-v3';
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const CATEGORY_LABELS = {
  'pure-legal': '法定假',
  'makeup-off': '调休',
  'schedule-rest': '休息',
  'adjusted-work': '法定调休',
  'regular-work': '上班'
};

const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth() + 1;
let selectedDateKey = '';
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
  settingsToggle: document.querySelector('#settings-toggle'),
  calendarGrid: document.querySelector('#calendar-grid'),
  weekdayHeader: document.querySelector('#weekday-header'),
  weekStartsOn: document.querySelector('#week-starts-on'),
  anchorMonday: document.querySelector('#anchor-monday'),
  anchorWeekType: document.querySelector('#anchor-week-type'),
  currentWeekBadge: document.querySelector('#current-week-badge'),
  summaryRest: document.querySelector('#summary-rest'),
  summaryPure: document.querySelector('#summary-pure'),
  summarySchedule: document.querySelector('#summary-schedule'),
  summaryAdjusted: document.querySelector('#summary-adjusted'),
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
  return storageRead(STORAGE_KEY) ?? storageRead(LEGACY_STORAGE_KEY);
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
    if ([3, 4].includes(saved?.version)) {
      return {
        version: 4,
        settings: sanitizeSettings(saved.settings),
        holidays: sanitizeHolidays(saved.holidays),
        loadedYears: sanitizeLoadedYears(saved.loadedYears ?? [2026])
      };
    }
  } catch (error) {
    console.warn('读取假期设置失败', error);
  }

  return {
    version: 4,
    settings: {
      ...DEFAULT_SETTINGS,
      bigRestDays: [...DEFAULT_SETTINGS.bigRestDays],
      smallRestDays: [...DEFAULT_SETTINGS.smallRestDays]
    },
    holidays: cloneBuiltInHolidays(),
    loadedYears: [2026]
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
  elements.settingsView.hidden = !isSettings;
  elements.settingsToggle.textContent = isSettings ? '返回日历' : '设置';
  elements.settingsToggle.setAttribute('aria-expanded', String(isSettings));
}

function renderSettings() {
  elements.weekStartsOn.value = String(state.settings.weekStartsOn);
  elements.anchorMonday.value = state.settings.anchorMonday;
  elements.anchorWeekType.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === state.settings.anchorWeekType);
  });

  document.querySelectorAll('.weekday-options').forEach((container) => {
    const mode = container.dataset.mode;
    const selectedDays = mode === 'big' ? state.settings.bigRestDays : state.settings.smallRestDays;
    container.replaceChildren();

    WEEKDAY_LABELS.forEach((label, index) => {
      const wrapper = document.createElement('label');
      wrapper.className = 'weekday-check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = selectedDays.includes(index);
      input.dataset.day = String(index);
      input.dataset.mode = mode;
      const text = document.createElement('span');
      text.textContent = label;
      wrapper.append(input, text);
      container.append(wrapper);
    });
  });

  const todayKey = toLocalDateKey(now);
  const currentWeekType = getWeekType(todayKey, state.settings);
  elements.currentWeekBadge.textContent = currentWeekType === 'big' ? '本周大休' : '本周小休';
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
    const day = classifyDay(dateKey, state.settings, state.holidays);
    const visualCategory = day.visualCategory ?? day.category;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `day-cell ${visualCategory}`;
    button.classList.add(`week-${day.weekType}`);
    button.classList.toggle('has-adjustment', Boolean(day.adjustment));
    button.classList.toggle('outside-month', !dateKey.startsWith(currentMonthPrefix));
    button.classList.toggle('today', dateKey === todayKey);
    button.dataset.date = dateKey;
    const displayName = day.category === 'pure-legal' ? day.holiday?.name ?? '' : '';
    const adjustmentLabel = day.adjustment ? ` ${CATEGORY_LABELS[day.adjustment]}` : '';
    button.setAttribute('aria-label', `${dateKey} ${displayName || CATEGORY_LABELS[visualCategory]}${adjustmentLabel}`);

    const top = document.createElement('span');
    top.className = 'day-top';
    const number = document.createElement('strong');
    number.className = 'day-number';
    number.textContent = String(Number(dateKey.slice(8)));
    top.append(number);

    const tags = document.createElement('span');
    tags.className = 'day-tags';

    if (day.adjustment) {
      const adjustmentTag = document.createElement('small');
      adjustmentTag.className = 'adjustment-tag';
      adjustmentTag.textContent = CATEGORY_LABELS[day.adjustment];
      tags.append(adjustmentTag);
    }

    if (tags.childElementCount > 0) {
      top.append(tags);
    }

    const name = document.createElement('span');
    name.className = 'day-name';
    name.textContent = displayName;
    const status = document.createElement('span');
    status.className = 'day-status';
    status.textContent = CATEGORY_LABELS[visualCategory];
    button.append(top, name, status);
    elements.calendarGrid.append(button);
  });
}

function renderSummary() {
  const summary = getMonthSummary(viewYear, viewMonth, state.settings, state.holidays);
  elements.summaryRest.textContent = summary.totalRest;
  elements.summaryPure.textContent = summary.pureLegal;
  elements.summarySchedule.textContent = summary.scheduleRest;
  elements.summaryAdjusted.textContent = summary.adjustedWork;
}

function renderYearResult() {
  const breakdown = getYearLegalBreakdown(viewYear, state.settings, state.holidays);
  const todayKey = toLocalDateKey(now);
  const currentHolidays = breakdown.pure.filter((item) => item.dateKey >= todayKey);
  const expiredHolidays = breakdown.pure.filter((item) => item.dateKey < todayKey);
  elements.resultYear.textContent = viewYear;
  elements.yearPureCount.textContent = `${currentHolidays.length} 天`;
  renderHolidayList(elements.pureHolidayList, currentHolidays, '本年暂无可用法定假');
  elements.expiredHolidaySection.hidden = expiredHolidays.length === 0;
  elements.expiredHolidayCount.textContent = `${expiredHolidays.length} 天`;
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
    const name = item.name || '法定假日';
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
    date.textContent = formatHolidayDates(sortedItems.map((item) => item.dateKey));
    const holidayName = document.createElement('strong');
    holidayName.textContent = name;
    const week = document.createElement('small');
    week.textContent = `${sortedItems.length} 天`;
    row.append(date, holidayName, week);
    container.append(row);
  });
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
  const adjustmentLabel = day.adjustment ? ` · ${CATEGORY_LABELS[day.adjustment]}` : '';
  const visualCategory = day.visualCategory ?? day.category;
  elements.datePreview.textContent = `${day.weekType === 'big' ? '大休周' : '小休周'} · ${CATEGORY_LABELS[visualCategory]}${adjustmentLabel}`;
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
    if (![3, 4].includes(imported?.version)) {
      throw new Error('不支持的数据版本');
    }

    state = {
      version: 4,
      settings: sanitizeSettings(imported.settings),
      holidays: sanitizeHolidays(imported.holidays),
      loadedYears: sanitizeLoadedYears(imported.loadedYears ?? [2026])
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

function formatHolidayDates(dateKeys) {
  let previousMonth = '';
  return dateKeys.map((dateKey) => {
    const [, month, day] = dateKey.split('-');
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
elements.settingsToggle.addEventListener('click', () => {
  setView(activeView === 'settings' ? 'calendar' : 'settings');
});

elements.calendarGrid.addEventListener('click', (event) => {
  const day = event.target.closest('.day-cell');
  if (day) {
    openDateDialog(day.dataset.date);
  }
});

document.querySelector('.result-panel').addEventListener('click', (event) => {
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

elements.anchorWeekType.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-value]');
  if (!button) {
    return;
  }

  state.settings.anchorWeekType = button.dataset.value;
  persist();
  render();
});

document.querySelector('.settings-panel').addEventListener('change', (event) => {
  const checkbox = event.target.closest('.weekday-check input');
  if (!checkbox) {
    return;
  }

  const field = checkbox.dataset.mode === 'big' ? 'bigRestDays' : 'smallRestDays';
  const day = Number(checkbox.dataset.day);
  const nextDays = checkbox.checked
    ? [...state.settings[field], day]
    : state.settings[field].filter((item) => item !== day);
  state.settings[field] = [...new Set(nextDays)].sort();
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
