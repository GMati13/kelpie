#!/bin/sh
# Runs a program with a file as its input, the file and its folder removed before the program starts,
# so what it holds is never on a command line (where `ps` shows it to every user of the machine) nor
# left on disk. Herdr's exec() takes no input, so stories.js brew() writes What next?'s task into a
# private folder of its own (mktemp -d) and hands that folder here.
#   stdin.sh <folder> <program> [arg…]   (reads <folder>/task)
dir=$1
shift
[ -n "$dir" ] && [ $# -gt 0 ] || { echo "usage: stdin.sh <folder> <program> [arg…]" >&2; exit 2; }
exec 3< "$dir/task" || exit 2
rm -f -- "$dir/task"
rmdir -- "$dir" 2>/dev/null
exec "$@" <&3 3<&-
