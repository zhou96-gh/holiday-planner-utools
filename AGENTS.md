# 项目结构约定

- `index.html` 和 `plugin.json` 保留在根目录，确保 uTools 能直接加载插件。
- 页面交互与样式放在 `src/`，节假日领域逻辑放在 `src/holiday/`。
- 内置配色放在 `themes/*.json`，配置必须含名称和完整浅深两套；更新文件时同步维护供浏览器读取的 `themes/index.json`，uTools 通过预加载脚本读取该目录。
- 插件图标和界面图片放在 `assets/`，测试放在 `tests/`。
- 离线安装包通过 `npm run build:offline` 生成到 `dist/holiday-planner-utools/`，必须包含 `themes/` 和预加载脚本；不得直接打包项目根目录。
- Windows 版 uTools 打包 WSL 项目时，必须先将生成目录复制到 Windows 本机路径，不直接使用 WSL UNC 路径。
- 修改后至少运行 `npm test` 和 `npm run build:offline`，并通过浏览器验证入口页面可正常加载。
- 修改数据持久化或导入导出时，保持 `src/holiday/storage.js` 为新格式编解码的单一来源，验证节假日区间单日修正后的无损往返及运行时按日期索引的结果。
- 调班持久化为一次操作及带类型的半天日期范围集合，旧版单段记录不迁移且启动时清理旧存储；页面按调休、补班范围分别展示，编辑和删除针对整次操作；关联类型为“不需要”的操作不计入调班余额；整次操作所有日期早于系统当天时才自动清理。
