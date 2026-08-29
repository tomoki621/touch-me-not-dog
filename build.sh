#!/bin/sh
# tap.html (タップ版) を Artifact 用の断片 (touch-me-not.html) に変換する。
# Artifact 側は <!doctype>/<html>/<head>/<body> を自前で付けるため、外側のタグだけ落とす。
# チューニングは index.html だけ触って、これを流し直せば同期できる。
sed -e '/^<!doctype html>$/d' \
    -e '/^<html lang="ja">$/d' \
    -e '/^<\/\?head>$/d' \
    -e '/^<\/\?body>$/d' \
    -e '/^<\/html>$/d' \
    -e '/^<meta /d' \
    tap.html > touch-me-not.html
echo "built touch-me-not.html ($(wc -l < touch-me-not.html) lines)"
