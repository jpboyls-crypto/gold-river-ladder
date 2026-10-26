#!/usr/bin/env python3
"""Build demo/index.html from index.html.

The demo runs the real app code (../app.js) against made-up data from
demo/demo-data.js instead of Firebase, so it never touches real members'
data. Re-run this after changing index.html:  python3 tools/build-demo.py
"""
import re, shutil, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'index.html').read_text(encoding='utf-8')
out = src

# swap the three Firebase SDK scripts for the demo stand-in
fb = re.findall(r'<script src="https://www\.gstatic\.com/firebasejs/[^"]+"></script>\n?', out)
assert len(fb) == 3, f'expected 3 Firebase scripts, found {len(fb)}'
out = out.replace(fb[0], '<script src="demo-data.js"></script>\n', 1)
for tag in fb[1:]:
    out = out.replace(tag, '', 1)

# assets live one folder up; the demo isn't installable as an app
out = re.sub(r'<link rel="manifest"[^>]*>\n?', '', out)
out = out.replace('href="icon-192.png"', 'href="../icon-192.png"')
out = re.sub(r'<script src="app\.js\?v=([\w-]+)"></script>', r'<script src="../app.js?v=\1"></script>', out)
out = out.replace('<title>Gold River Tennis Ladder</title>',
                  '<title>Gold River Tennis Ladder — Demo</title>\n<meta name="robots" content="noindex">')

(root / 'demo' / 'index.html').write_text(out, encoding='utf-8')
shutil.copyfile(root / 'qr-signup.png', root / 'demo' / 'qr-signup.png')
print('demo/index.html built')
