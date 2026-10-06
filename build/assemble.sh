#!/bin/sh
# Assemble index.html from the sources beside this script plus a data.json.
#
#   build/assemble.sh [path/to/data.json]
#
# With no argument it looks for data.json in the current directory, then next
# to this script. Writes index.html at the repository root.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DIR/.." && pwd)

DATA=${1:-}
[ -n "$DATA" ] || { [ -f "./data.json" ] && DATA="./data.json"; }
[ -n "$DATA" ] || { [ -f "$DIR/data.json" ] && DATA="$DIR/data.json"; }
# Falling back to the data already embedded in index.html means a change to the
# stylesheet or the scripts does not need the 25 MB of source feeds re-fetched.
REUSE=""
if [ -z "$DATA" ] || [ ! -f "$DATA" ]; then
  if [ -f "$ROOT/index.html" ]; then
    REUSE=1
  else
    echo "assemble.sh: no data.json and no existing index.html to reuse data from." >&2
    echo "             Build it first (see build/README.md), or pass a path." >&2
    exit 1
  fi
fi

python3 - "$DIR" "$DATA" "$ROOT/index.html" "$REUSE" <<'PY'
import io,sys,re
src,data,out,reuse=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
rd=lambda name: io.open(src+"/"+name,encoding="utf-8").read()
if reuse:
    prev=io.open(out,encoding="utf-8").read()
    m=re.search(r"\nconst DATA=(.*?);\n", prev, re.S)
    if not m:
        sys.exit("assemble.sh: could not find the data block in the existing index.html")
    DATA_TEXT=m.group(1)
    print("reusing the data already in index.html")
else:
    DATA_TEXT=io.open(data,encoding="utf-8").read()
sys.path.insert(0,src)
from validate import parse_data, validate, print_report
try:
    report=validate(parse_data(DATA_TEXT))
except ValueError as exc:
    sys.exit("assemble.sh: invalid data: " + str(exc))
print_report(report)
if report.failed():
    sys.exit("assemble.sh: data validation failed; index.html was not written")
html="".join([
 '<!DOCTYPE html>\n<html lang="en" data-theme="dark">\n<head>\n'
 '<meta charset="UTF-8">\n'
 '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
 '<title>Amtrak signal map</title>\n',
 rd("head_extra.html"),
 rd("style.css"),
 '\n<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">\n'
 '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>\n'
 '</head>\n<body>\n',
 rd("body.html"),
 "\n<script>\nconst DATA=", DATA_TEXT, ";\n",
 rd("core.js"),"\n",rd("map.js"),"\n",rd("ui.js"),"\n",rd("agenda.js"),"\n",rd("app.js"),
 "\n</script>\n</body>\n</html>\n"])
io.open(out,"w",encoding="utf-8").write(html)
print("index.html: %.0f KB" % (len(html.encode())/1024))
PY
