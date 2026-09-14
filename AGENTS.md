# 项目结构约定

- `index.html` 和 `plugin.json` 保留在根目录，确保 uTools 能直接加载插件。
- 页面交互与样式放在 `src/`，节假日领域逻辑放在 `src/holiday/`。
- 插件图标和界面图片放在 `assets/`，测试放在 `tests/`。
- 离线安装包通过 `npm run build:offline` 生成到 `dist/holiday-planner-utools/`，不得直接打包项目根目录。
- Windows 版 uTools 打包 WSL 项目时，必须先将生成目录复制到 Windows 本机路径，不直接使用 WSL UNC 路径。
- 修改后至少运行 `npm test` 和 `npm run build:offline`，并通过浏览器验证入口页面可正常加载。
