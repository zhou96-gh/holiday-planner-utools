import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { BUILT_IN_HOLIDAYS } from '../src/holiday/data.js';
import { DEFAULT_SETTINGS } from '../src/holiday/core.js';
import {
  STORAGE_VERSION,
  CUSTOM_COLOR_TOKENS,
  decodeState,
  decodeCustomColorsImport,
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
  const adjustment = { id: 'test-rest', associationType: 'none', ranges: [{
    type: 'rest', startDate: '2026-09-14', startPeriod: 'am',
    endDate: '2026-09-14', endPeriod: 'pm'
  }], note: '测试', createdAt: 1 };
  const state = {
    settings: DEFAULT_SETTINGS,
    holidays: BUILT_IN_HOLIDAYS,
    loadedYears: [2026],
    adjustments: [adjustment]
  };
  const expected = [{ id: 'test-rest', associationType: 'none', ranges: [{
    type: 'rest', startDate: '2026-09-14', startPeriod: 'am',
    endDate: '2026-09-14', endPeriod: 'pm'
  }], note: '测试', createdAt: 1 }];
  assert.deepEqual(decodeState(JSON.parse(JSON.stringify(encodeState(state)))).adjustments, expected);
  assert.deepEqual(encodeState(state).adjustments, expected);
  assert.throws(() => decodeState({ version: 5, holidays: BUILT_IN_HOLIDAYS }), /不支持的数据版本/);
  assert.throws(() => decodeState({ version: 6, holidayData: { blocks: [], days: {} } }),
    /不支持的数据版本/);
  assert.throws(() => decodeState({ version: 7, holidayData: { blocks: [], days: null } }),
    /节假日存储格式无效/);
  const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const STORAGE_KEY = 'holiday-planner-state-v7'/);
  assert.match(appSource, /const LEGACY_STORAGE_KEYS = \[\s*'holiday-planner-state-v6'/);
  assert.deepEqual(encodeState({ ...state, adjustments: [{
    id: 'old', type: 'rest', startDate: '2026-09-14', startPeriod: 'am',
    endDate: '2026-09-14', endPeriod: 'pm'
  }] }).adjustments, []);
});

test('连续的同类型半天范围在状态读取与写入时保持合并', () => {
  const state = { settings: DEFAULT_SETTINGS, holidays: BUILT_IN_HOLIDAYS, loadedYears: [2026],
    adjustments: [{ id: 'paired', associationType: 'required', note: '', createdAt: 100, ranges: [
      { type: 'rest', startDate: '2026-09-28', startPeriod: 'am',
        endDate: '2026-09-29', endPeriod: 'am' },
      { type: 'work', startDate: '2026-09-19', startPeriod: 'am',
        endDate: '2026-09-20', endPeriod: 'pm' },
      { type: 'rest', startDate: '2026-09-29', startPeriod: 'pm',
        endDate: '2026-09-30', endPeriod: 'pm' }
    ] }] };
  const encoded = encodeState(state);
  assert.equal(encoded.adjustments[0].ranges.length, 2);
  assert.deepEqual(decodeState({ ...encoded, adjustments: state.adjustments }).adjustments,
    encoded.adjustments);
  assert.deepEqual(decodeState(encoded).adjustments, encoded.adjustments);
});

test('右键多项仍为列表，编辑窗口使用调班与修正 tab', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="adjustment-picker-list" class="adjustment-picker-list"/);
  assert.match(html, /id="adjustment-type"[^>]+role="tablist"/);
  assert.match(html, /id="adjustment-fields" role="tabpanel"/);
  assert.match(html, /id="correction-fields" role="tabpanel"/);
  assert.match(app, /button\.setAttribute\('aria-selected', String\(selected\)\)/);
  assert.match(app, /tabs\[next\]\.click\(\)/);
});

test('不需要关联时只编辑当前日期类型，已有另一类日期独立保留', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="rest-range-section"/);
  assert.match(html, /id="work-range-section"/);
  assert.ok(app.includes('counterpartSection.before(primarySection)'));
  assert.ok(app.includes("setDialogFieldsEnabled(counterpartSection, !isCorrection && associationType === 'required')"));
  assert.ok(app.includes("ranges: associationType === 'none'"));
  assert.ok(app.includes('getAdjustmentRanges(existing).filter((range) => range.type !== activeAdjustmentRangeType)'));
});

test('日历无顶栏，设置齿轮悬浮且设置页可返回日历', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /class="app-header"/);
  assert.match(html, /id="settings-toggle" class="settings-fab"/);
  assert.match(html, /id="settings-back" class="secondary-button"/);
  assert.doesNotMatch(html, /偏好设置/);
  assert.ok(css.includes('.settings-fab {'));
  assert.ok(css.includes('position: fixed;'));
  assert.ok(app.includes('settingsBack.addEventListener'));
});

test('日历网格和普通日期格没有专用底色，状态格仍保留分类底色', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.calendar-grid {\n  border-top: 1px solid var(--border-strong);\n  border-left: 1px solid var(--border-strong);\n  background: transparent;'));
  assert.ok(css.includes('.day-cell {\n  --day-cell-background: transparent;'));
  assert.ok(css.includes('.day-cell.schedule-rest { --day-cell-background: var(--rest-bg); }'));
  assert.ok(css.includes('.day-cell.manual-work { --day-cell-background: var(--manual-work-bg); }'));
});

test('编辑弹窗外点击关闭，内部保持紧凑布局', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.ok(app.includes("adjustmentDialog.addEventListener('click'"));
  assert.ok(app.includes('event.target !== elements.adjustmentDialog'));
  assert.ok(css.includes('width: min(480px, calc(100vw - 24px))'));
  assert.ok(css.includes('#adjustment-form { padding: 16px; }'));
});

test('主题默认跟随系统，显式模式可往返且无效值回退', () => {
  const state = {
    settings: DEFAULT_SETTINGS,
    holidays: BUILT_IN_HOLIDAYS,
    loadedYears: [2026],
    adjustments: [],
    appearance: 'dark'
  };
  const encoded = encodeState(state);
  assert.equal(encoded.appearance, 'dark');
  assert.equal(decodeState(encoded).appearance, 'dark');
  assert.equal(decodeState({ ...encoded, appearance: 'light' }).appearance, 'light');
  assert.equal(decodeState({ ...encoded, appearance: 'invalid' }).appearance, 'system');
  const { appearance, ...legacyState } = encoded;
  assert.equal(decodeState(legacyState).appearance, 'system');
});

test('配色方案选择可往返保存，旧数据默认配色', () => {
  const state = {
    settings: DEFAULT_SETTINGS, holidays: BUILT_IN_HOLIDAYS,
    loadedYears: [2026], adjustments: [], colorSchemeId: 'calendar-colors-08-fresh-v2.json'
  };
  const encoded = encodeState(state);
  assert.equal(encoded.colorSchemeId, state.colorSchemeId);
  assert.equal(decodeState(encoded).colorSchemeId, state.colorSchemeId);
  assert.equal(decodeState({ ...encoded, colorSchemeId: 'custom' }).colorSchemeId, 'custom');
  assert.equal(decodeState({ ...encoded, colorSchemeId: '../outside.json' }).colorSchemeId, 'default');
  const { colorSchemeId, ...oldState } = encoded;
  assert.equal(decodeState(oldState).colorSchemeId, 'default');
});

test('内置配色配置名称、清单与预加载读取的目录一致', () => {
  const index = JSON.parse(readFileSync(new URL('../themes/index.json', import.meta.url), 'utf8'));
  const preloadUrl = new URL('../preload.js', import.meta.url);
  const context = {
    require: createRequire(preloadUrl),
    __dirname: dirname(fileURLToPath(preloadUrl)),
    window: {}
  };
  runInNewContext(readFileSync(preloadUrl, 'utf8'), context);
  const schemes = context.window.readBuiltInColorSchemes();
  assert.deepEqual(Array.from(schemes, (scheme) => scheme.id), index.files);
  assert.equal(schemes.length, index.files.length);
  assert.equal(new Set(schemes.map((scheme) => scheme.name)).size, schemes.length);
  for (const scheme of schemes) {
    assert.ok(scheme.name);
    const colors = decodeCustomColorsImport(scheme);
    assert.equal(Object.keys(colors.light).length, CUSTOM_COLOR_TOKENS.length);
    assert.equal(Object.keys(colors.dark).length, CUSTOM_COLOR_TOKENS.length);
  }
  const plugin = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
  assert.equal(plugin.preload, 'preload.js');
  const build = readFileSync(new URL('../scripts/build-offline.js', import.meta.url), 'utf8');
  assert.match(build, /'preload\.js'.*'themes'/);
});

test('默认深色配色和设置预览同步覆盖全部主题变量', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const darkDefaults = app.match(/  dark: \{([\s\S]*?)\n  \}\n\};/)?.[1];
  assert.ok(darkDefaults);
  const defaults = Object.fromEntries([...darkDefaults.matchAll(/(?:'([^']+)'|([a-z]+)):\s*'(#[0-9a-f]{6,8})'/g)]
    .map((match) => [match[1] ?? match[2], match[3]]));
  assert.equal(defaults.page, '#303633');
  assert.equal(defaults.surface, '#48514a');
  assert.equal(defaults.panel, '#3e4741');
  assert.equal(defaults['rest-bg'], '#465b4e');
  const blocks = [
    css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1],
    css.match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/)?.[1]
  ];
  for (const block of blocks) {
    assert.ok(block);
    const variables = Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6,8});/g)]
      .map((match) => [match[1], match[2]]));
    for (const token of CUSTOM_COLOR_TOKENS) {
      assert.equal(variables[token], defaults[token], token);
    }
  }
});

test('浅深自定义配色往返，错误颜色或字段被忽略', () => {
  const state = {
    settings: DEFAULT_SETTINGS,
    holidays: BUILT_IN_HOLIDAYS,
    loadedYears: [2026],
    adjustments: [],
    customColors: {
      light: { page: '#aBcD12', primary: '#123456', unknown: '#ffffff', text: 'red' },
      dark: { 'rest-bg': '#0a0b0c', green: '#88ffaa' }
    }
  };
  const encoded = encodeState(state);
  assert.deepEqual(encoded.customColors, {
    light: { page: '#abcd12', primary: '#123456' },
    dark: { green: '#88ffaa', 'rest-bg': '#0a0b0c' }
  });
  assert.deepEqual(decodeState(encoded).customColors, encoded.customColors);
  const { customColors, ...legacyState } = encoded;
  assert.deepEqual(decodeState(legacyState).customColors, { light: {}, dark: {} });
  assert.deepEqual(decodeState({ ...encoded, customColors: { light: [], dark: 'invalid' } }).customColors,
    { light: {}, dark: {} });
});

test('配色覆盖全部主题变量，透明度和旧配色可往返保存', () => {
  assert.equal(CUSTOM_COLOR_TOKENS.length, 36);
  const customColors = {
    light: {
      page: '#aBcD12', 'header-text': '#112233',
      'primary-hover': '#345678', stripe: '#26756880',
      'toc-bg': '#01020300', 'tag-neutral-bg': '#111111ff',
      green: '#aa00bbcc', unknown: '#ffffff'
    },
    dark: {
      'preview-error-bg': '#112233', gold: '#ffee11',
      stripe: '#112233', surface: '#11223344'
    }
  };
  const encoded = encodeState({
    settings: DEFAULT_SETTINGS, holidays: BUILT_IN_HOLIDAYS,
    loadedYears: [2026], adjustments: [], customColors
  });
  assert.deepEqual(encoded.customColors, {
    light: {
      page: '#abcd12', 'header-text': '#112233',
      'primary-hover': '#345678', stripe: '#26756880',
      'toc-bg': '#01020300', 'tag-neutral-bg': '#111111ff'
    },
    dark: { 'preview-error-bg': '#112233', gold: '#ffee11' }
  });
  assert.deepEqual(decodeState(encoded).customColors, encoded.customColors);
});

test('独立与完整数据文件可导入配色，浅深两套按导入值替换', () => {
  const palette = {
    light: { page: '#ABCD12', stripe: '#01234580', unknown: '#ffffff' },
    dark: { primary: '#112233', 'toc-bg': '#aabbcc44' }
  };
  const expected = {
    light: { page: '#abcd12', stripe: '#01234580' },
    dark: { 'toc-bg': '#aabbcc44', primary: '#112233' }
  };
  assert.deepEqual(decodeCustomColorsImport(palette), expected);
  const exported = encodeState({
    settings: DEFAULT_SETTINGS, holidays: BUILT_IN_HOLIDAYS,
    loadedYears: [2026], adjustments: [], customColors: palette
  });
  assert.deepEqual(decodeCustomColorsImport(exported), expected);
  assert.deepEqual(decodeCustomColorsImport({ light: {}, dark: {} }), { light: {}, dark: {} });
});

test('四类日期背景可导入透明度并在存储往返中保留，旧配色仍可导入', () => {
  const colors = decodeCustomColorsImport({
    light: { 'rest-bg': '#abcdef00', 'holiday-bg': '#12345680' },
    dark: { 'manual-rest-bg': '#11223366', 'manual-work-bg': '#445566' }
  });
  const encoded = encodeState({
    settings: DEFAULT_SETTINGS, holidays: BUILT_IN_HOLIDAYS,
    loadedYears: [2026], adjustments: [], customColors: colors
  });
  assert.deepEqual(decodeState(encoded).customColors, colors);
  assert.equal(colors.light['rest-bg'], '#abcdef00');
  assert.equal(colors.dark['manual-work-bg'], '#445566');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const token of ['rest-bg', 'holiday-bg', 'manual-rest-bg', 'manual-work-bg']) {
    assert.match(html, new RegExp('data-alpha-token="' + token + '"'));
  }
});

test('透明度滑杆 0% 为不透明，100% 为全透明，导入颜色格式不变', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(app, /color.length === 7 \? '0'/);
  assert.match(app, /1 - parseInt\(color.slice\(7\), 16\) \/ 255/);
  assert.match(app, /100 - Number\(alpha.value\)/);
  assert.match(html, /透明度滑杆 <code>0%<\/code> 完全不透明/);
});

test('配色导入拒绝残缺、无效值和无法识别的颜色', () => {
  assert.throws(() => decodeCustomColorsImport({ light: { page: '#112233' } }),
    /浅色和深色/);
  assert.throws(() => decodeCustomColorsImport({ customColors: null }),
    /浅色和深色/);
  assert.throws(() => decodeCustomColorsImport({ light: { page: '#12345678' }, dark: {} }),
    /light.page/);
  assert.throws(() => decodeCustomColorsImport({ light: {}, dark: { stripe: '#112233' } }),
    /dark.stripe/);
  assert.throws(() => decodeCustomColorsImport({ light: { unknown: '#123456' }, dark: {} }),
    /没有可识别/);
});

test('节假日数据导入结构示例可完整解码和重新导出', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const guide = html.match(/<details class="color-import-guide data-import-guide">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(guide);
  const example = guide.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)?.[1];
  const imported = JSON.parse(example);
  const decoded = decodeState(imported);
  assert.deepEqual(Object.keys(imported).sort(), Object.keys(encodeState(decoded)).sort());
  assert.equal(imported.version, STORAGE_VERSION);
  assert.equal(decoded.holidays['2026-10-01'].kind, 'block');
  assert.equal(decoded.holidays['2026-10-02'], undefined);
  assert.equal(decoded.holidays['2026-10-03'].name, '示例假期');
  assert.equal(decoded.holidays['2026-09-25'].kind, 'legal');
  assert.deepEqual(decoded.adjustments[0].ranges.map((range) => range.type), ['rest', 'work']);
  assert.deepEqual(decodeState(encodeState(decoded)).adjustments, decoded.adjustments);
  assert.match(guide, /导入完整数据会覆盖当前设置/);
  assert.match(guide, /旧版本文件不支持/);
});

test('导入配色结构说明示例有效且列出全部受支持字段', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const guide = html.match(/<details class="color-import-guide">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(guide);
  const example = guide.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)?.[1];
  assert.deepEqual(decodeCustomColorsImport(JSON.parse(example)), {
    light: { page: '#eef0ed', stripe: '#26756824' },
    dark: { page: '#141a16', stripe: '#75d0b130' }
  });
  const fields = [...guide.matchAll(/<dd><code>([^<]+)<\/code><\/dd>/g)]
    .flatMap((match) => match[1].split(', '));
  assert.deepEqual(fields, CUSTOM_COLOR_TOKENS);
  assert.match(guide, /四种日期背景/);
});
