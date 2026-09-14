import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const packageRoot = resolve(distRoot, 'holiday-planner-utools');
const packageFiles = ['plugin.json', 'index.html', 'assets', 'src'];

if (!packageRoot.startsWith(`${distRoot}${sep}`)) {
  throw new Error('离线打包目录必须位于 dist 目录内');
}

await rm(packageRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });

for (const file of packageFiles) {
  await cp(join(projectRoot, file), join(packageRoot, file), { recursive: true });
}

const plugin = JSON.parse(await readFile(join(packageRoot, 'plugin.json'), 'utf8'));
for (const file of [plugin.main, plugin.logo]) {
  const fileStat = await stat(join(packageRoot, file));
  if (!fileStat.isFile()) {
    throw new Error(`插件运行文件不存在：${file}`);
  }
}

console.log(`离线打包目录：${packageRoot}`);
