// 日本語フォント「廻想体 ネクストUP（B）」（もじワク研究）の Web フォントを、作者のサイトから取ってきて public/fonts に置く。
// ライセンス（https://moji-waku.com/mj_work_license/）は Web フォントとしての利用は可だが、無断の再配布・改変は不可。
// そのためフォントのファイルはリポジトリに入れず（.gitignore 済み）、ここで公式の配布物をそのまま使う。
//   npm run font:kaiso     （abc-play は、ファイルが無ければ自動で実行する）
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const URL = "https://moji-waku.com/download/kaiso_up_web.zip";
const CACHE = join(ROOT, ".cache", "kaiso");
const FILE = "Kaisotai-Next-UP-B.woff2";
const OUT = join(ROOT, "public", "fonts", FILE);

if (existsSync(OUT) && !process.argv.includes("--force")) {
  console.log(`${FILE} はあります`);
  process.exit(0);
}
mkdirSync(CACHE, { recursive: true });
const zip = join(CACHE, "kaiso_up_web.zip");
console.log(`download ${URL}`);
const res = await fetch(URL);
if (!res.ok) {
  console.error(`取得できませんでした（HTTP ${res.status}）。日本語は UDEV Gothic で表示されます。`);
  process.exit(1);
}
writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
execFileSync("unzip", ["-o", "-q", zip, "-d", CACHE]);
copyFileSync(join(CACHE, "kaiso_up_web", FILE), OUT);
console.log(`public/fonts/${FILE} を置きました`);
