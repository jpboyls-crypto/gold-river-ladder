#!/usr/bin/env python3
"""Build junior/index.html from index.html.

The junior ladder runs the same app.js with window.LADDER_MODE='junior'. That switches it to the jr_
collections, parent sign-in, the junior divisions and junior wording. This script only swaps the
static page text and the Add-player form. Re-run it after changing index.html:
    python3 tools/build-junior.py
"""
import re, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
out = (root / 'index.html').read_text(encoding='utf-8')


def rep(old, new, count=1):
    global out
    n = out.count(old)
    assert n == count, f'expected {count} of {old[:60]!r}, found {n}'
    out = out.replace(old, new)


# head
rep('<title>Gold River Tennis Ladder</title>', '<title>Gold River Junior Tennis Ladder</title>')
rep('content="Gold River Sports Club adult tennis ladder — challenges, scores, standings and hitting partners."',
    'content="Gold River Sports Club junior tennis ladder — divisions, challenges, Matchplay Days and standings."')
rep('<meta name="apple-mobile-web-app-title" content="GR Ladder">', '<meta name="apple-mobile-web-app-title" content="GR Junior Ladder">')
rep('<link rel="apple-touch-icon" href="icon-192.png">', '<link rel="apple-touch-icon" href="../icon-192.png">')
rep('<link rel="icon" href="icon-192.png">', '<link rel="icon" href="../icon-192.png">')
m = re.search(r'<script src="app\.js\?v=([\w-]+)"></script>', out)
assert m
out = out.replace(m.group(0), f'<script>window.LADDER_MODE=\'junior\';</script>\n<script src="../app.js?v={m.group(1)}"></script>')
# no Practice board in the junior app (kids don't post availability)
rep('</style>\n</head>', '#navPractice{display:none!important}\n</style>\n</head>')

# names on screen
rep('<div class="logo-text">Gold River Tennis Ladder</div>', '<div class="logo-text">Gold River Junior Ladder</div>')
rep('<h1>Gold River<br>Tennis Ladder</h1>', '<h1>Gold River<br>Junior Tennis Ladder</h1>')
rep("<p>Enter the email you signed up with. We'll send you a one-tap sign-in link — no password to remember.</p>",
    "<p>Parents and guardians: enter the email you used to sign your child up. We'll send you a one-tap sign-in link — no password to remember.</p>")
rep('<h1>Signed in, but not on the ladder yet</h1>', '<h1>Signed in, but no junior player linked yet</h1>')
rep('How the Gold River Tennis Ladder works.', 'How the Gold River Junior Tennis Ladder works.')

# draw picker
start = out.index('<div class="draw-grid" style="margin-top:16px" id="ladderTabs">')
end = out.index('</div>', out.index('data-ladder="mx"')) + len('</div>')
end = out.index('</div>', end) + len('</div>')
tabs = [('o10', 'Orange 10U'), ('g12', 'Green 12U'), ('b14', 'Boys 14U'), ('g14', 'Girls 14U'),
        ('b16', 'Boys 16U'), ('g16', 'Girls 16U'), ('b18', 'Boys 18U'), ('g18', 'Girls 18U')]
grid = '<div class="draw-grid" style="margin-top:16px" id="ladderTabs">\n' + '\n'.join(
    f'      <div class="tab{" active" if i == 0 else ""}" data-ladder="{k}" onclick="switchLadder(\'{k}\',this)">{v}</div>'
    for i, (k, v) in enumerate(tabs)) + \
    '\n      <div class="tab tab-wide" data-ladder="jd" onclick="switchLadder(\'jd\',this)">Junior Doubles</div>\n    </div>'
out = out[:start] + grid + out[end:]

# profile + install wording
rep('<div class="section-head">My contact info</div>', '<div class="section-head">Parent contact info</div>')
rep('Other ladder members see this so they can set up matches with you.',
    'Other ladder families see your number (not your child’s) so they can set up matches parent to parent.')
rep('Look for the Gold River Ladder icon on your home screen.', 'Look for the GR Junior Ladder icon on your home screen.')
rep('The Gold River Ladder icon is now in your app drawer and home screen.', 'The GR Junior Ladder icon is now in your app drawer and home screen.')
rep("Tap <b>Ladder</b> and find your name in each draw you joined.", "Tap <b>Ladder</b> and find your child in their division.")
rep("<b>Or just hit.</b> The <b>Practice</b> tab lets you post when you're free — no points, no pressure.",
    "<b>Sign up for a Matchplay Day.</b> The <b>Events</b> tab lists them. We pair players and enter the scores for you.")

# admin
rep('New sign-ups from the flyer QR / digital form land here. Approve to add them to the ladder — set up the house charge at the front desk, then send them the welcome text.',
    'Parents’ sign-ups from the junior form land here, with the division each player goes into. Approve to add them, set up the house charge on the parent’s account, then send the parent the welcome.')
rep('placeholder="Search members…"', 'placeholder="Search players…"')
rep('Tap any player to edit points, UTR, draws, billing or status.', 'Tap any player to edit their division, parents, points, UTR, billing or status.')
start = out.index('<div id="adminAdd" hidden>')
end = out.index('Starting points come from NTRP', start)
end = out.index('</div>', end) + len('</div>')   # that note
end = out.index('</div>', end) + len('</div>')   # the card; the adminAdd wrapper close stays
add_form = '''<div id="adminAdd" hidden>
      <div class="card" style="padding:16px">
        <div class="section-head" style="padding-top:0">Add a junior player</div>
        <div class="form-group"><label class="form-label">Player's full name</label><input type="text" id="jrName" placeholder="e.g. Emma Lopez"></div>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:14px;margin-bottom:12px;line-height:1.4">
          <input type="checkbox" id="jrPaper" onchange="jrTogglePaper()" style="width:auto;margin-top:3px">
          <span><b>Paper player</b> — the family doesn't use the app. A parent phone is enough.</span>
        </label>
        <div id="jrPaperNote" hidden style="font-size:12.5px;line-height:1.5;color:var(--fg2);background:var(--surface2);border-radius:8px;padding:10px 12px;margin:-4px 0 12px">They appear on the ladder with a 📞 so other parents know to call. Enter their results with <b>✍️ Enter a score</b>.</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Birth year</label><input type="number" id="jrBirth" inputmode="numeric" placeholder="e.g. 2014" min="2005" max="2022" oninput="jrSuggest()"></div>
          <div class="form-group"><label class="form-label">Boy / Girl</label><select id="jrGender" onchange="jrSuggest()"><option value="M">Boy</option><option value="F">Girl</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Ball color</label><select id="jrBall" onchange="jrSuggest()"><option>Red</option><option>Orange</option><option>Green</option><option selected>Yellow</option></select></div>
          <div class="form-group"><label class="form-label">Division</label><select id="jrDiv">
            <option value="o10">Orange Ball 10U</option><option value="g12">Green Ball 12U</option>
            <option value="b14">Boys 14U</option><option value="g14">Girls 14U</option><option value="b16">Boys 16U</option>
            <option value="g16">Girls 16U</option><option value="b18" selected>Boys 18U</option><option value="g18">Girls 18U</option></select></div>
        </div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;margin-bottom:14px"><input type="checkbox" id="jrDoubles" style="width:auto"> Also play Junior Doubles</label>
        <div class="form-row">
          <div class="form-group"><label class="form-label">UTR Singles</label><input type="number" id="jrUTRS" placeholder="Optional" step="0.01" min="1" max="16"></div>
          <div class="form-group"><label class="form-label">UTR Doubles</label><input type="number" id="jrUTRD" placeholder="Optional" step="0.01" min="1" max="16"></div>
        </div>
        <div class="section-head" style="padding-top:6px">Parent / guardian</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Parent name</label><input type="text" id="jrParentName" placeholder="e.g. Maria Lopez"></div>
          <div class="form-group"><label class="form-label">Parent mobile</label><input type="tel" id="jrPhone" inputmode="tel" placeholder="(916) 555-1234"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label" id="jrParentLabel">Parent email (their login)</label><input type="email" id="jrParent" inputmode="email" placeholder="parent@example.com"></div>
          <div class="form-group"><label class="form-label">2nd parent email</label><input type="email" id="jrParent2" inputmode="email" placeholder="Optional"></div>
        </div>
        <button class="btn btn-primary btn-full" onclick="addPlayer()">Add player to the junior ladder</button>
        <div style="font-size:12px;color:var(--fg2);margin-top:10px;line-height:1.5">The division fills in from birth year, gender and ball color; change it if needed. Everyone starts at 1200 points. A parent with several children uses the same email for each one.</div>
      </div>'''
out = out[:start] + add_form + out[end:]

(root / 'junior').mkdir(exist_ok=True)
(root / 'junior' / 'index.html').write_text(out, encoding='utf-8')
print('junior/index.html built')
