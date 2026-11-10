#!/bin/sh
# Downloads one person's picture for their avatar into Herdr's art folder (Herdr draws images only
# from its own folder, never from the web). The address comes from the board (an assignee's
# avatarUrls, Jira's or a GitHub Project's), so it's checked here too: https only, Gravatar, GitHub's
# or Atlassian's public avatar host, never the Jira site, as nothing here signs in. The file is kept only when it is a PNG, JPEG, GIF or WebP under
# 1 MB, saved as <name>.<its type>, and its file name printed. Run by stories.js (fetchAvatars()).
#   avatar.sh <folder> <name> <url>
dir=$1 name=$2 url=$3
case $name in ''|*[!0-9a-z]*) echo "bad name" >&2; exit 2 ;; esac
printf '%s' "$url" | grep -Eq '^https://(secure\.gravatar\.com|avatars\.githubusercontent\.com|avatar-management--avatars\.[a-z0-9-]+\.prod\.public\.atl-paas\.net)/[A-Za-z0-9._~%/?=&+-]*$' || { echo "not an avatar address" >&2; exit 2; }
mkdir -p "$dir" || exit 1
tmp=$(mktemp "$dir/.avatar.XXXXXX") || exit 1
trap 'rm -f "$tmp"' EXIT
# Redirects (Gravatar's default picture is Atlassian's) stay on https; no config file of the person's.
curl -q -fsSL --proto =https --proto-redir =https --max-redirs 3 --max-time 15 --max-filesize 1048576 -o "$tmp" -- "$url" || exit 1
[ "$(wc -c < "$tmp")" -le 1048576 ] || { echo "too big" >&2; exit 1; }
magic=$(head -c 12 "$tmp" | od -An -tx1 | tr -d ' \n')
case $magic in
  89504e47*) ext=png ;;
  ffd8ff*) ext=jpg ;;
  47494638*) ext=gif ;;
  52494646????????57454250) ext=webp ;;
  *) echo "not an image" >&2; exit 1 ;;
esac
out="$dir/$name.$ext"
# A link in the way is replaced, never written through.
[ -L "$out" ] && rm "$out"
mv "$tmp" "$out" && chmod 644 "$out" && echo "$name.$ext"
