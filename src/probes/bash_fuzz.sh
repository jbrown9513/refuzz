# Runs one fuzz target for many inputs in one bash process: the target (which sources the project and defines `fuzz`) is
# sourced once, then each input arrives on stdin as one line, its raw bytes escaped for `printf %b`. The bytes go to a file
# and, NUL bytes dropped (a Bash string cannot hold one), to `fuzz` as "$1", run in a subshell of its own process group with
# xtrace on and a time limit. The answer on fd 3 is the exit status, what fuzz printed and the status it returned (absent when
# something called `exit`), bash's stderr, the last command traced, and the trace's project line edges.
# Usage: bash bash_fuzz.sh <target.sh> <scratch dir> <timeout seconds> <the project's folder>
target=$1 work=$2 limit=$3 root=$4
exec 3>&1 1>&2
# Each input's subshell gets a process group of its own, so a time limit kills everything it started.
set -m
PS4='+${BASH_SOURCE[0]-}:${LINENO}: '
set -u -o pipefail
source "$target" 2>"$work/.load" </dev/null
if ! declare -F fuzz >/dev/null; then
  printf '@@fatal\n' >&3
  { head -c 3000 "$work/.load"; printf '\nthe target defines no function fuzz\n'; } >&3
  printf '@@end\n' >&3
  exit 0
fi
printf '@@ready\n' >&3
while IFS= read -r line; do
  rm -f "$work/.r" "$work/.t" "$work/.e" "$work/.o"
  printf '%b' "$line" >"$work/.in"
  data=$(tr -d '\000' <"$work/.in"; printf x)
  data=${data%x}
  (
    exec 9>"$work/.t"
    BASH_XTRACEFD=9
    RANDOM=0
    set -x
    fuzz "$data" >"$work/.o"
    st=$?
    { set +x; } 2>/dev/null
    out=$(head -c 300 "$work/.o")
    printf '%s [exit %s]' "${out@Q}" "$st" >"$work/.r"
  ) </dev/null >/dev/null 2>"$work/.e" &
  pid=$!
  (sleep "$limit"; kill -KILL -- -"$pid") >/dev/null 2>&1 &
  watch=$!
  wait "$pid"
  status=$?
  kill -KILL -- -"$watch" "$watch" >/dev/null 2>&1
  kill -KILL -- -"$pid" >/dev/null 2>&1
  wait "$watch" 2>/dev/null
  {
    printf '@@begin %s\n' "$status"
    cat "$work/.r" 2>/dev/null
    printf '\n@@stderr\n'
    head -c 4000 "$work/.e" 2>/dev/null
    printf '\n@@last\n'
    grep -a '^+' "$work/.t" 2>/dev/null | tail -n 1 | head -c 400
    printf '\n@@trace\n'
    sed -n 's/^+\{1,\}\([^:]*\):\([0-9]\{1,\}\): .*/\1:\2/p' "$work/.t" 2>/dev/null |
      awk -v root="$root/" '$0 !~ /^\// || index($0, root) == 1 { if (!s[p ">" $0]++) print p ">" $0; p = $0 }' | head -20000
    printf '@@end\n'
  } >&3
done
