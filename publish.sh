#!/bin/sh
# Выложить веб-версию на GitHub Pages: папка web/ уходит в публичный репозиторий knighthead-web.
# Сайт обновится через минуту: https://fedotinad253.github.io/knighthead-web/
set -e
cd "$(git rev-parse --show-toplevel)"
git subtree split --prefix web -b web-pages
git push https://github.com/Fedotinad253/knighthead-web.git web-pages:main
