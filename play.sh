#!/bin/zsh
# ABC をローカルで起動して、ブラウザで開く。止めるときは Ctrl+C。
#   ./play.sh               http://localhost:5210/
#   ./play.sh --port 8000   オプションは vite にそのまま渡す
# どこからでも `abc-play` で呼べるよう、~/.local/bin にリンクしてある（README 参照）。
ROOT="${0:A:h}"
cd "$ROOT" || exit 1

# Node 22 以上を使う（シェル既定の node が古いときは nvm から探す）
node_ok() { command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]]; }
if ! node_ok; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh" && nvm use --silent "$(cat .nvmrc)" >/dev/null 2>&1
fi
if ! node_ok; then
  echo "Node 22 以上が見つかりません。nvm install $(cat .nvmrc) を実行してください。" >&2
  exit 1
fi

# 初回と依存が変わったときだけ npm install
if [[ ! -d node_modules || package-lock.json -nt node_modules/.package-lock.json ]]; then
  echo "依存をインストールしています..."
  npm install --no-audit --no-fund || exit 1
fi

# 日本語フォント（廻想体）は再配布できないので、無ければ作者のサイトから取ってくる（失敗しても UDEV Gothic で動く）
[[ -f public/fonts/Kaisotai-Next-UP-B.woff2 ]] || node scripts/fetch-kaiso.mjs || true

exec npx vite --port 5210 --open "$@"
