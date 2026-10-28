#!/bin/zsh
# Снимки моделей в движке игры (headless Chrome, swiftshader), 9 ракурсов на кадр.
#   stand.sh <папка> <модель>[@ref] ...
# модель — ключ MODELS: m412 kabluk pickup kombi oda largus vesta elargus;
# @ref — glb из git (HEAD, 2259191…), иначе — из рабочей копии.
# Окружение: LO=1 — облегчённый набор трафика; D=4 — вблизи (по умолчанию 6); C='#c63a2a' — цвет кузова; PORT (8790).
# Файл: <папка>/<модель>[@ref][-lo]-d<D>.png. Сервер и public/_cmp/ скрипт поднимает и убирает сам.
set -e
out=${1:?папка}; shift
root=${0:A:h:h:h:h}; skill=${0:A:h}; port=${PORT:-8790}; D=${D:-6}; C=${C:-#e8e8e8}
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p $out
if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null; then echo "порт $port занят (чужой сервер не трогать) — задай PORT" >&2; exit 1; fi
mkdir -p $root/public/_cmp && cp $skill/stand.html $root/public/_cmp/g.html
python3 $root/tools/serve.py $port >/dev/null 2>&1 & srv=$!
trap "kill $srv 2>/dev/null; rm -rf $root/public/_cmp" EXIT
python3 -c "import time; time.sleep(1)"
typeset -A glb=(m412 moskvich)
for spec in "$@"; do
  m=${spec%@*}; ref=${spec#*@}; [[ $ref == $spec ]] && ref=
  extra=
  if [[ -n $ref ]]; then
    git -C $root show $ref:public/models/${glb[$m]:-$m}.glb > $root/public/_cmp/$m-$ref.glb
    extra="&glb=_cmp/$m-$ref.glb"
  fi
  f=$out/$spec${LO:+-lo}-d$D.png
  "$CHROME" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars --window-size=1800,1020 \
    --virtual-time-budget=30000 --screenshot=$f \
    "http://127.0.0.1:$port/_cmp/g.html?m=$m&d=$D&lo=${LO:-0}&c=${C//\#/%23}$extra" 2>/dev/null
  echo $f
done
