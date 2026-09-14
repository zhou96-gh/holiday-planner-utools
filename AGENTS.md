# 项目结构约定

- `index.html` 和 `plugin.json` 保留在根目录，确保 uTools 能直接加载插件。
- 页面交互与样式放在 `src/`，节假日领域逻辑放在 `src/holiday/`。
- 插件图标和界面图片放在 `assets/`，测试放在 `tests/`。
- 修改后至少运行 `npm test`，并通过浏览器验证入口页面可正常加载。
