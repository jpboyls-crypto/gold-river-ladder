#!/usr/bin/env python3
"""Build the demo pages from index.html.

The demo runs the real app code (app.js) against made-up data from
demo/demo-data.js instead of Firebase, so it never touches real members'
data. It is branded for Spare Time Indoor Center and comes in two sports:
    demo/index.html             tennis
    demo/pickleball/index.html  pickleball
Re-run this after changing index.html:  python3 tools/build-demo.py
"""
import re, shutil, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'index.html').read_text(encoding='utf-8')


def build(sport, folder, up):
    out = src
    # swap the three Firebase SDK scripts for the demo stand-in
    fb = re.findall(r'<script src="https://www\.gstatic\.com/firebasejs/[^"]+"></script>\n?', out)
    assert len(fb) == 3, f'expected 3 Firebase scripts, found {len(fb)}'
    ver = re.search(r'app\.js\?v=([\w-]+)', out).group(1)
    out = out.replace(fb[0], f'<script>window.DEMO_SPORT=\'{sport}\';window.DEMO_ROOT=\'{up}\';</script>\n'
                             f'<script src="{"" if folder == "demo" else "../"}demo-data.js?v={ver}"></script>\n', 1)
    for tag in fb[1:]:
        out = out.replace(tag, '', 1)
    # assets live at the site root; the demo isn't installable as an app
    out = re.sub(r'<link rel="manifest"[^>]*>\n?', '', out)
    out = out.replace('href="icon-192.png"', f'href="{up}icon-192.png"')
    out = re.sub(r'<script src="app\.js\?v=([\w-]+)"></script>', rf'<script src="{up}app.js?v=\1"></script>', out)
    name = 'STI ' + ('Pickleball' if sport == 'pickleball' else 'Tennis') + ' Ladder'
    out = out.replace('<title>Gold River Tennis Ladder</title>',
                      f'<title>{name} — Demo</title>\n<meta name="robots" content="noindex">')
    d = root / folder
    d.mkdir(parents=True, exist_ok=True)
    (d / 'index.html').write_text(out, encoding='utf-8')
    shutil.copyfile(root / 'qr-signup.png', d / 'qr-signup.png')
    print(f'{folder}/index.html built ({sport})')


build('tennis', 'demo', '../')
build('pickleball', 'demo/pickleball', '../../')
