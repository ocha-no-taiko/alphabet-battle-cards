"""日本語フォント（UDEV Gothic 35）を、ゲームで使う文字だけに絞って public/fonts に書き出す。

英数字は JetBrains Mono を使い、日本語だけをこのフォントで描く（UDEV Gothic の英数字は JetBrains Mono なので見た目がそろう）。
src/ と audio/ 以外のテキスト（JSON・TS）から ASCII 以外の文字を集め、ひらがな・カタカナ・全角記号はすべて含める。
文言を足して表示がほかのフォントになったら、もう一度実行する:

    npm run font:jp
"""

import pathlib
import re
import subprocess
import sys
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "udev-gothic"
VERSION = "v2.2.0"
URL = f"https://github.com/yuru7/udev-gothic/releases/download/{VERSION}/UDEVGothic_{VERSION}.zip"
OUT = ROOT / "public" / "fonts"
WEIGHTS = {"Regular": "UDEVGothic35-Regular.ttf", "Bold": "UDEVGothic35-Bold.ttf"}


def fetch() -> pathlib.Path:
    src = CACHE / f"UDEVGothic_{VERSION}"
    if (src / WEIGHTS["Regular"]).exists():
        return src
    CACHE.mkdir(parents=True, exist_ok=True)
    zpath = CACHE / "udev.zip"
    print(f"download {URL}")
    urllib.request.urlretrieve(URL, zpath)
    with zipfile.ZipFile(zpath) as z:
        z.extractall(CACHE)
    zpath.unlink()
    return src


def used_chars() -> str:
    chars: set[str] = set()
    for path in list((ROOT / "src").rglob("*.ts")) + list((ROOT / "src").rglob("*.json")) + [ROOT / "index.html"]:
        chars.update(c for c in path.read_text(encoding="utf-8") if ord(c) > 0x7F)
    # ひらがな・カタカナ・全角の記号と英数字・CJK の句読点はすべて入れる（後で文言を足しても困らないように）
    for lo, hi in [(0x3000, 0x303F), (0x3040, 0x309F), (0x30A0, 0x30FF), (0xFF00, 0xFFEF)]:
        chars.update(chr(c) for c in range(lo, hi + 1))
    return "".join(sorted(chars))


def main() -> None:
    src = fetch()
    text = used_chars()
    kanji = len([c for c in text if re.match(r"[一-鿿]", c)])
    print(f"{len(text)} chars（漢字 {kanji}）")
    OUT.mkdir(parents=True, exist_ok=True)
    for weight, file in WEIGHTS.items():
        dest = OUT / f"UDEVGothic35-JP-{weight}.woff2"
        subprocess.run(
            [sys.executable, "-m", "fontTools.subset", str(src / file), f"--text={text}",
             f"--output-file={dest}", "--flavor=woff2", "--layout-features=*", "--no-hinting"],
            check=True,
        )
        print(f"{dest.relative_to(ROOT)} {dest.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
