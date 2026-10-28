/* ═══════════════════════════════════════════════════════════════════════════
   Ladder app — DEMO MODE (Spare Time Indoor Center, tennis or pickleball)
   Stands in for Firebase with an in-memory database filled with made-up
   players, two months of matches, events and more. Nothing here talks to the
   real database; every change is lost on reload.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
const DAY = 86400000;

/* ───────────── demo club + sport ─────────────
   The demo shows the real app code branded for Spare Time Indoor Center.
   demo/ is tennis, demo/pickleball/ is pickleball (set by window.DEMO_SPORT).
   Wording is swapped on screen as the app draws it, so the live app's code is untouched. */
const PB = window.DEMO_SPORT === 'pickleball';
const ROOT = window.DEMO_ROOT || '../';
const CLUB = 'Spare Time Indoor Center', CLUB_SHORT = 'Spare Time Indoor';
const REPL = [
  [/Gold River and club-wide Spare Time members/g, 'Spare Time members'], [/Gold River Sports Club/g, CLUB], [/GOLD RIVER SPORTS CLUB/g, CLUB.toUpperCase()], [/Gold River SC\b/g, CLUB_SHORT], [/GOLD RIVER/g, CLUB_SHORT.toUpperCase()], [/Gold River/g, CLUB_SHORT]
].concat(PB ? [
  [/([Bb])est of 3 sets, with a 10-point tiebreak in place of a third set/g, '$1est of 3 games to 11, win by 2'],
  [/a new can of balls and the winner keeps them/g, 'a new ball and the winner keeps it'],
  [/brings a new can, and the winner keeps them/g, 'brings a new ball, and the winner keeps it'],
  [/brings the can/g, 'brings the ball'], [/Who brings the balls\?/g, 'Who brings the ball?'],
  [/Hitting \/ rally/g, 'Drilling / dinking'], [/Hitting Partner/g, 'Practice Partner'], [/hitting partner/g, 'practice partner'],
  [/Working on my backhand, happy to feed balls too/g, 'Working on my third-shot drop, happy to drill dinks too'],
  [/6-3, 7-5/g, '11-7, 11-9'], [/e\.g\. 8\.50/g, 'e.g. 3.85'], [/e\.g\. 9\.00/g, 'e.g. 4.10'],
  [/USTA /g, ''], [/NTRP/g, 'Level'], [/UTR/g, 'DUPR'], [/🎾/g, '🏓'],
  [/Tennis/g, 'Pickleball'], [/tennis/g, 'pickleball']
] : []);
const fx = str => REPL.reduce((t, [re, to]) => t.replace(re, to), str);
function fxNode(n){
  if (n.nodeType === 3) {
    const par = n.parentNode; if (par && (par.nodeName === 'SCRIPT' || par.nodeName === 'STYLE' || (par.closest && par.closest('#demoBanner')))) return;
    const v = fx(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v;
  } else if (n.nodeType === 1) {
    if (n.nodeName === 'SCRIPT' || n.nodeName === 'STYLE' || n.id === 'demoBanner') return;
    if (n.placeholder) { const v = fx(n.placeholder); if (v !== n.placeholder) n.placeholder = v; }
    for (const c of n.childNodes) fxNode(c);
  }
}
new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') fxNode(m.target); else m.addedNodes.forEach(fxNode); } })
  .observe(document.documentElement, { subtree: true, childList: true, characterData: true });
document.addEventListener('DOMContentLoaded', () => {
  fxNode(document.body); document.title = fx(document.title);
  // welcome messages are built as text for Gmail / Messages
  ['welcomeText', 'welcomeEmail'].forEach(f => { const o = window[f]; if (typeof o === 'function') window[f] = function(){ const r = o.apply(this, arguments); return typeof r === 'string' ? fx(r) : r; }; });
});

/* ───────────── in-memory Firebase (compat API subset the app uses) ───────────── */
const store = {};              // { collection: { id: data } }
const listeners = {};          // { collection: [ {fn, order} ] }
let idc = 0;
const SENT = { ts: { __ts: true } };
function applyOps(cur, data){
  const out = Object.assign({}, cur);
  for (const [k, v] of Object.entries(data)) {
    if (v && v.__ts) out[k] = { seconds: Math.floor(Date.now()/1000) };
    else if (v && v.__union !== undefined) out[k] = [...new Set([...(out[k]||[]), v.__union])];
    else if (v && v.__remove !== undefined) out[k] = (out[k]||[]).filter(x => JSON.stringify(x) !== JSON.stringify(v.__remove));
    else out[k] = v;
  }
  return out;
}
function snap(col, order){
  let docs = Object.entries(store[col]||{}).map(([id, d]) => ({ id, data: () => d, exists: true }));
  if (order) {
    const [f, dir] = order;
    docs.sort((a, b) => { const x = a.data()[f], y = b.data()[f]; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); });
  }
  return { docs, size: docs.length, empty: !docs.length };
}
function notify(col){ (listeners[col]||[]).forEach(l => l.fn(snap(col, l.order))); }
function docRef(col, id){
  return {
    id,
    async set(data, opt){ store[col] = store[col]||{}; store[col][id] = applyOps((opt && opt.merge) ? (store[col][id]||{}) : {}, data); notify(col); },
    async update(data){ if (!store[col] || !store[col][id]) throw new Error('not found'); store[col][id] = applyOps(store[col][id], data); notify(col); },
    async delete(){ if (store[col]) delete store[col][id]; notify(col); },
    async get(){ const d = store[col] && store[col][id]; return { id, exists: !!d, data: () => d }; }
  };
}
function query(col, order){
  return {
    doc: id => docRef(col, id || ('demo' + (++idc))),
    async add(data){ const r = docRef(col, 'demo' + (++idc)); await r.set(data); return r; },
    orderBy: (f, dir) => query(col, [f, dir||'asc']),
    where: () => query(col, order), limit: () => query(col, order),
    async get(){ return snap(col, order); },
    onSnapshot(fn){ const l = { fn, order }; (listeners[col] = listeners[col]||[]).push(l); setTimeout(() => fn(snap(col, order)), 0); return () => { listeners[col] = listeners[col].filter(x => x !== l); }; }
  };
}
let authUser = null; const authCbs = [];
window.firebase = {
  initializeApp(){},
  auth(){ return {
    onAuthStateChanged(cb){ authCbs.push(cb); setTimeout(() => cb(authUser), 0); },
    isSignInWithEmailLink: () => false,
    async sendSignInLinkToEmail(){},
    async signInWithEmailLink(){},
    async signOut(){ authUser = null; authCbs.forEach(cb => cb(null)); }
  }; },
  firestore(){ return { collection: c => query(c) }; }
};
window.firebase.firestore.FieldValue = {
  serverTimestamp: () => SENT.ts,
  arrayUnion: v => ({ __union: v }),
  arrayRemove: v => ({ __remove: v })
};

/* ───────────── deterministic made-up data ───────────── */
let seed = 20261027;
const rnd = () => (seed = (seed * 16807) % 2147483647, (seed - 1) / 2147483646);
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const today0 = new Date(); today0.setHours(0, 0, 0, 0);
const T0 = today0.getTime(), NOW = Date.now();
const ds = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const ts = ms => ({ seconds: Math.floor(ms / 1000) });
const put = (col, id, d) => { (store[col] = store[col] || {})[id] = d; };

const MEN = ['Marcus','Ryan','Kevin','Brian','Steve','Daniel','Tom','Raj','Chris','Andre','Greg','Mike','Jason','Paul','Eric','Sam','Nate','Victor','Owen','Luis','David','Mark','Jeff','Scott','Tony','Gary','Rick','Ben','Alex','Sean','Matt','Hiro','Omar','Derek','Carlos','Frank','Phil','Doug','Ray','Ken','Bill','Joe','Hank','Jim','Ted','Walt','Russ','Neil'];
const WOMEN = ['Sarah','Linda','Amy','Carol','Nina','Rachel','Jenna','Maria','Kate','Priya','Dana','Megan','Tina','Hannah','Lauren','Grace','Julie','Karen','Lisa','Wendy','Susan','Diane','Monica','Erin','Holly','Paula','Rosa','Mei','Aisha','Beth','Joan','Nancy','Kim','Laura','Shelly','Gina','Tracy','Ann','Debbie','Robin'];
const LAST = ['Delgado','Whitaker','Tran','Okafor','Lindqvist','Cho','Haverford','Malhotra','Bennett','Lewis','Paulson','Serrano','Kimura','Novak','Dunham','Ortega','Fischer','Reyes','McCarthy','Acosta','Mitchell','Park','Johnson','Barnes','Santos','Kowalski','Liu','Gonzalez','Sullivan','Shah','Whitfield','O’Neil','Brooks','Weiss','Pike','Adeyemi','Henderson','Lopez','Nakamura','Fitzgerald','Romero','Chen','Patel','Morrison','Gallagher','Ito','Duarte','Hoffman','Keller','Russo','Vasquez','Bishop','Coleman','Grant','Holt','Jensen','Larsen','Moreno','Nguyen','Perry','Quinn','Rhodes','Stone','Thornton','Vance','Wells','Young','Zimmerman','Abbott','Carver'];
const LEVELS = ['3.0','3.0','3.5','3.5','3.5','3.5','4.0','4.0','4.0','4.0','4.5','4.5','4.5','5.0'];
const BASE = { '2.5': 1000, '3.0': 1100, '3.5': 1200, '4.0': 1400, '4.5': 1600, '5.0': 1800 };
const SKILL = { '3.0': .30, '3.5': .42, '4.0': .55, '4.5': .68, '5.0': .80 };
const UTR = PB ? { '3.0': 3.1, '3.5': 3.6, '4.0': 4.1, '4.5': 4.6, '5.0': 5.15 } : { '3.0': 3.4, '3.5': 4.5, '4.0': 5.8, '4.5': 7.1, '5.0': 8.5 };   // pickleball: DUPR
const RSPREAD = PB ? .35 : 1.2;
const AVAIL = ['Weekday evenings','Sat & Sun mornings','Lunchtime Tue/Thu','Early mornings before work','Weekends only','Mon/Wed/Fri mornings','Any evening after 6','Flexible — just text me'];

const players = []; const used = new Set();
function newName(firsts){ for (;;) { const n = pick(firsts) + ' ' + pick(LAST); if (!used.has(n)) { used.add(n); return n; } } }
function phone(){ return '(916) 555-' + String(1000 + Math.floor(rnd() * 8999)); }
function slug(n){ return n.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, ''); }
function mkPlayer(gender, opts){
  opts = opts || {};
  const name = opts.name || newName(gender === 'M' ? MEN : WOMEN);
  const lvl = opts.ntrp || pick(LEVELS);
  const joinedDaysAgo = opts.joined != null ? opts.joined : 58 + Math.floor(rnd() * 8);
  const paper = !!opts.paper, social = !!opts.social;
  const id = opts.id || (paper ? 'paper-' + slug(name).replace(/\./g, '-') : slug(name) + '@demo.club');
  const ranked = !social;
  const p = {
    name, initials: name.split(' ').map(x => x[0]).join(''), email: paper ? '' : id, phone: phone(), paper, social,
    ntrp: lvl, gender, membership: rnd() < .75 ? 'full' : 'tennis',
    singles: ranked && (opts.singles != null ? opts.singles : rnd() < (PB ? .34 : .62)),
    doubles: ranked && (opts.doubles != null ? opts.doubles : rnd() < .78),
    mixed:   ranked && (opts.mixed   != null ? opts.mixed   : rnd() < (PB ? .74 : .58)),
    utrSingles: rnd() < .7 ? +(UTR[lvl] + rnd() * RSPREAD - RSPREAD * .42).toFixed(2) : null,
    utrDoubles: rnd() < .6 ? +(UTR[lvl] + (PB ? .05 : .3) + rnd() * RSPREAD - RSPREAD * .42).toFixed(2) : null,
    baseSingles: BASE[lvl] + pick([-40, -20, 0, 0, 20, 40]), baseDoubles: BASE[lvl] + pick([-40, -20, 0, 0, 20, 40]), baseMixed: BASE[lvl] + pick([-40, -20, 0, 0, 20, 40]),
    availability: pick(AVAIL), active: true, billingStart: '2027-01-01',
    createdAt: ts(T0 - joinedDaysAgo * DAY + 10 * 3600000), approvedBy: 'jpboyls@gmail.com'
  };
  if (ranked && !p.singles && !p.doubles && !p.mixed) p.doubles = true;
  Object.defineProperty(p, '_id', { value: id }); Object.defineProperty(p, '_skill', { value: SKILL[lvl] + rnd() * .16 - .08 });
  Object.defineProperty(p, '_join', { value: T0 - joinedDaysAgo * DAY });
  players.push(p); return p;
}
// the admin, playing too
const jordan = mkPlayer('M', { name: 'Jordan Boyls', id: 'jpboyls@gmail.com', ntrp: '4.5', singles: true, doubles: true, mixed: true, joined: 66 });
if (PB) { jordan.utrSingles = 4.52; jordan.utrDoubles = 4.71; } else { jordan.utrSingles = 9.24; jordan.utrDoubles = 9.8; } jordan.availability = 'Evenings after lessons';
for (let i = 0; i < 44; i++) mkPlayer('M');
for (let i = 0; i < 36; i++) mkPlayer('F');
// newer members (joined in the last ~3 weeks)
for (let i = 0; i < 4; i++) mkPlayer('M', { joined: 3 + Math.floor(rnd() * 16) });
for (let i = 0; i < 4; i++) mkPlayer('F', { joined: 3 + Math.floor(rnd() * 16) });
// members who play without the app
['M', 'M', 'F'].forEach(g => mkPlayer(g, { paper: true, ntrp: pick(['3.0', '3.5', '4.0']) }));
// social members (not ranked)
['F', 'F', 'M', 'F', 'M', 'F'].forEach(g => mkPlayer(g, { social: true }));
// two members on a pause (injury / travel)
const paused = players.filter(p => !p.social && !p.paper && p !== jordan).slice(20, 22);
paused.forEach((p, i) => { p.active = false; p.inactiveSince = ds(T0 - (12 + i * 9) * DAY); });

const ranked = players.filter(p => !p.social);
const inDraw = (p, t) => ({ ms: p.singles && p.gender === 'M', ws: p.singles && p.gender === 'F', md: p.doubles && p.gender === 'M', wd: p.doubles && p.gender === 'F', mx: p.mixed })[t];

// a few steady doubles partnerships
const steady = { md: [], wd: [], mx: [] };
['md', 'wd'].forEach(t => { const pool = shuffle(ranked.filter(p => inDraw(p, t) && p.active)); for (let i = 0; i + 1 < pool.length && steady[t].length < 6; i += 2) steady[t].push([pool[i], pool[i + 1]]); });
{ const M = shuffle(ranked.filter(p => p.mixed && p.gender === 'M' && p.active)), F = shuffle(ranked.filter(p => p.mixed && p.gender === 'F' && p.active)); for (let i = 0; i < 6 && i < M.length && i < F.length; i++) steady.mx.push([M[i], F[i]]); }
// make sure Jordan has a regular partner in men's and mixed doubles
steady.md[0] = [jordan, steady.md[0][1]]; steady.mx[0] = [jordan, steady.mx[0][1]];

const SCORES_CLOSE = PB ? ['11-9, 11-8', '11-7, 9-11, 11-8', '12-10, 11-9', '9-11, 11-6, 11-9', '11-8, 11-9', '13-11, 11-7', '8-11, 11-9, 11-7']
                        : ['7-5, 6-4', '6-4, 7-6', '4-6, 6-3, 10-7', '6-3, 4-6, 10-8', '7-6, 6-4', '6-4, 6-4', '3-6, 6-4, 10-6'];
const SCORES_EASY = PB ? ['11-3, 11-4', '11-5, 11-2', '11-4, 11-6', '11-2, 11-5', '11-6, 11-3'] : ['6-2, 6-1', '6-1, 6-3', '6-3, 6-2', '6-0, 6-2', '6-2, 6-3'];
const SC = PB ? { pend: '11-8, 7-11, 11-9', note: '11-8, 8-11, 11-9' } : { pend: '6-4, 3-6, 10-8', note: '6-4, 4-6, 10-7' };
const skillOf = list => list.reduce((a, p) => a + p._skill, 0) / list.length;
let mid = 0;
const matches = [];
function addMatch(t, A, B, dayMs, extra){
  const sa = skillOf(A), sb = skillOf(B);
  const aWins = rnd() < 1 / (1 + Math.exp(-(sa - sb) * 7));
  const gap = Math.abs(sa - sb);
  const score = gap > .18 ? pick(SCORES_EASY) : pick(SCORES_CLOSE);
  const W = aWins ? A : B, L = aWins ? B : A;
  const subFrom = W.filter(p => !p.paper);
  const paperInvolved = A.concat(B).some(p => p.paper);
  const sub = paperInvolved || !subFrom.length ? jordan : pick(subFrom);
  const m = Object.assign({
    p1: W[0]._id, p1Partner: W[1] ? W[1]._id : null, p2: L[0]._id, p2Partner: L[1] ? L[1]._id : null,
    ladder: t, score, winner: W[0]._id, date: ds(dayMs), submittedBy: sub._id, status: 'confirmed',
    createdAt: ts(dayMs + (17 + Math.floor(rnd() * 4)) * 3600000)
  }, paperInvolved ? { enteredByAdmin: true } : {}, extra || {});
  if (sub._id !== m.p1 && sub._id !== m.p1Partner && !paperInvolved) { m.submittedBy = m.p1; }
  matches.push(['m' + (++mid), m]); return m;
}
const DRAW_W = PB ? [['ms', 12], ['ws', 8], ['md', 27], ['wd', 21], ['mx', 32]] : [['ms', 24], ['ws', 15], ['md', 23], ['wd', 16], ['mx', 22]];
function pickDraw(){ let r = rnd() * 100; for (const [t, w] of DRAW_W) { if ((r -= w) < 0) return t; } return 'mx'; }
function eligible(p, t, dayMs){ return inDraw(p, t) && p._join <= dayMs && (p.active || !p.inactiveSince || dayMs < new Date(p.inactiveSince + 'T00:00:00').getTime()); }
function near(pool, x){ const c = pool.filter(p => p !== x).sort((a, b) => Math.abs(a._skill - x._skill) - Math.abs(b._skill - x._skill)); return c[Math.min(c.length - 1, Math.floor(rnd() * Math.min(6, c.length)))]; }

for (let d = 60; d >= 1; d--) {
  const dayMs = T0 - d * DAY; const dow = new Date(dayMs).getDay();
  const n = (dow === 0 || dow === 6 ? 9 : 5) + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) {
    const t = pickDraw();
    const pool = ranked.filter(p => eligible(p, t, dayMs));
    if (pool.length < 4) continue;
    if (t === 'ms' || t === 'ws') { const a = pick(pool), b = near(pool, a); addMatch(t, [a], [b], dayMs); continue; }
    let A, B;
    if (rnd() < .45 && steady[t].length) {
      A = pick(steady[t]); if (!A.every(p => eligible(p, t, dayMs))) continue;
      const rest = pool.filter(p => !A.includes(p));
      if (t === 'mx') { const m = near(rest.filter(p => p.gender === 'M'), A[0]), f = near(rest.filter(p => p.gender === 'F'), A[1]); if (!m || !f) continue; B = [m, f]; }
      else { const x = near(rest, A[0]); const y = near(rest.filter(p => p !== x), A[1]); if (!x || !y) continue; B = [x, y]; }
    } else if (t === 'mx') {
      const M = shuffle(pool.filter(p => p.gender === 'M')), F = shuffle(pool.filter(p => p.gender === 'F')); if (M.length < 2 || F.length < 2) continue;
      A = [M[0], F[0]]; B = [near(M, M[0]), near(F, F[0])];
    } else { const s = shuffle(pool); A = [s[0], s[1]]; B = [near(s.slice(2), s[0]), null]; B[1] = near(s.slice(2).filter(p => p !== B[0]), s[1]); if (!B[0] || !B[1]) continue; }
    addMatch(t, A, B, dayMs);
  }
}
// a couple of recent forfeits and one disputed score for the admin's attention
const mens = ranked.filter(p => inDraw(p, 'ms') && p.active && p !== jordan);
addMatch('ms', [mens[3]], [mens[9]], T0 - 3 * DAY, { status: 'disputed', confirmedBy: mens[9]._id });
// fresh scores still waiting for the other side to confirm (inside 48 hours)
const recentPending = [[mens[5], mens[11]], [mens[14], mens[2]]];
recentPending.forEach(([a, b], i) => addMatch('ms', [a], [b], T0 - i * DAY, { status: 'pending', createdAt: ts(NOW - (5 + i * 20) * 3600000) }));
// one waiting on Jordan to confirm
{ const opp = near(ranked.filter(p => inDraw(p, 'ms') && p.active), jordan);
  const m = addMatch('ms', [opp], [jordan], T0 - DAY, { status: 'pending', createdAt: ts(NOW - 9 * 3600000) });
  m.p1 = opp._id; m.p2 = jordan._id; m.winner = opp._id; m.submittedBy = opp._id; m.score = SC.pend; }
matches.forEach(([id, m]) => put('matches', id, m));
// a few members keep their contact info private (Profile → My contact info)
players.filter(p => !p.paper && !p.social && p !== jordan).filter((p, i) => i % 9 === 4).forEach((p, i) => { if (i % 2) p.hideEmail = true; else p.hidePhone = true; });
players.forEach(p => put('players', p._id, p));

/* ───────────── challenges ───────────── */
let cid = 0;
function chal(from, to, t, status, ageH, msg){ put('challenges', 'c' + (++cid), { from: from._id, to: to._id, ladder: t, date: ds(T0 + (2 + Math.floor(rnd() * 4)) * DAY), message: msg || '', status, createdAt: ts(NOW - ageH * 3600000) }); }
const MSGS = ['Thursday evening work for you?', 'Up for a match this weekend?', 'I can do Sat 8am if you can.', 'Let’s play! Text me a time.', '', '', 'Rematch?'];
for (let i = 0; i < 14; i++) {
  const t = pick(['ms', 'ws', 'ms', 'ws']);
  const pool = ranked.filter(p => inDraw(p, t) && p.active && !p.paper && p !== jordan);
  const a = pick(pool), b = near(pool, a);
  chal(a, b, t, rnd() < .55 ? 'accepted' : 'pending', 6 + Math.floor(rnd() * 130), pick(MSGS));
}
{ const pool = ranked.filter(p => inDraw(p, 'ms') && p.active && !p.paper && p !== jordan);
  chal(near(pool, jordan), jordan, 'ms', 'pending', 20, 'Saw you’re #1 in my range — Saturday morning?');
  const tgt = pool.filter(p => p._skill > jordan._skill)[0] || pool[0];
  chal(jordan, tgt, 'ms', 'accepted', 50, 'Wednesday 7pm on court 3?');
  // rained out once and rescheduled (shows the rain-out tag and the admin rain-out log)
  Object.assign(store.challenges['c' + cid], { rainedOut: true, rainBy: tgt._id, rainAt: ts(NOW - 26 * 3600000), playBy: NOW - 50 * 3600000 + 14 * DAY, date: ds(T0 + 3 * DAY) });
  // two more rain-outs elsewhere on the ladder: one rescheduled, one cancelled
  { const wp = ranked.filter(p => inDraw(p, 'ws') && p.active && !p.paper); const a = wp[3], b = near(wp, a);
    chal(a, b, 'ws', 'accepted', 70, 'Thursday 6:30?'); Object.assign(store.challenges['c' + cid], { rainedOut: true, rainBy: b._id, rainAt: ts(NOW - 40 * 3600000), playBy: NOW - 70 * 3600000 + 14 * DAY });
    const x = wp[9], y = near(wp, x); chal(x, y, 'ws', 'rainout', 60, ''); Object.assign(store.challenges['c' + cid], { rainBy: x._id, rainAt: ts(NOW - 20 * 3600000) }); }
  // one expired, for the admin "needs attention" list
  const x = pick(pool), y = near(pool, x); chal(x, y, 'ms', 'accepted', 9 * 24 + 5, ''); }
for (let i = 0; i < 40; i++) { const t = pick(['ms', 'ws']); const pool = ranked.filter(p => inDraw(p, t)); const a = pick(pool), b = near(pool, a); put('challenges', 'c' + (++cid), { from: a._id, to: b._id, ladder: t, date: '', message: '', status: 'played', createdAt: ts(T0 - (10 + Math.floor(rnd() * 48)) * DAY) }); }

/* ───────────── practice board ───────────── */
const FORMATS = ['hit', 'drill', 'singles', 'doubles'];
const NOTES = PB ? ['Looking for a steady drilling partner, about an hour.', 'Happy to drill dinks and third-shot drops.', 'Need 2 more for practice doubles games.', 'Working on my serve and return depth — anyone want to rep it?', 'Early session before work, about an hour.', 'Practice games, no pressure.', 'Need a fourth for Saturday doubles!', 'Reset and hands-battle drills, all welcome.', 'Coming back from injury, easy pace please.', 'Want to play some games to 15.'] : ['Looking for a steady rally partner, 45–60 min.', 'Happy to feed balls and work on volleys.', 'Need 2 more for a practice doubles set.', 'Working on my serve — anyone want to do serve & return?', 'Early hit before work, about an hour.', 'Practice set, no pressure.', 'Need a fourth for Saturday doubles!', 'Lob and overhead drills, all welcome.', 'Coming back from injury, easy hitting please.', 'Want to play some tiebreaks.'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], TIMES = ['Early AM', 'Mid-morning', 'Lunch', 'Afternoon', 'Evening'];
const appPeople = players.filter(p => !p.paper);
for (let i = 0; i < 11; i++) {
  const by = i === 0 ? jordan : pick(appPeople);
  const resp = shuffle(appPeople.filter(p => p !== by && Math.abs(+p.ntrp - +by.ntrp) <= 1)).slice(0, Math.floor(rnd() * 4));
  put('hits', 'h' + i, { by: by._id, format: pick(FORMATS), range: pick([0.5, 0.5, 1.0, 99]), days: shuffle(DAYS).slice(0, 1 + Math.floor(rnd() * 3)), times: shuffle(TIMES).slice(0, 1 + Math.floor(rnd() * 2)),
    note: pick(NOTES), posted: ds(T0 - Math.floor(rnd() * 6) * DAY), responses: resp.map(p => p._id), closed: false, createdAt: ts(T0 - i * 3600000) });
}

/* ───────────── events (with who signed up / attended) ───────────── */
const rsvp = (n, pool) => shuffle((pool || appPeople)).slice(0, n).map(p => p._id);
const MIXER_DESC = 'Drop-in point play, food and drinks — come socialize and play. Matches you play can count toward the ladder (just enter the score in the app afterwards), or use the night to hit and practice with other members. All levels welcome; come and go as you like.';
let eid = 0;
function ev(o){ put('events', 'e' + (++eid), Object.assign({ location: CLUB, eligibility: '', rsvpOn: true, capacity: null, price: null, memberPrice: null, createdBy: 'jpboyls@gmail.com', createdAt: ts(T0 - 70 * DAY) }, o)); }
const lastFri = (y, m) => { const d = new Date(y, m + 1, 0); while (d.getDay() !== 5) d.setDate(d.getDate() - 1); return d; };
const mixerDates = [];
for (let k = -2; k <= 13; k++) {
  const base = new Date(today0.getFullYear(), today0.getMonth() + k, 1);
  let d = lastFri(base.getFullYear(), base.getMonth());
  const md = (d.getMonth() + 1) + '-' + d.getDate();
  const isThanksgivingFri = d.getMonth() === 10 && d.getDate() >= 23 && d.getDate() <= 29;
  if (isThanksgivingFri || md === '12-25' || md === '12-31') d = new Date(d.getTime() - 7 * DAY);
  if (d.getMonth() === 11 && d.getDate() === 24) d = new Date(d.getTime() - 7 * DAY);
  mixerDates.push(d);
}
mixerDates.forEach(d => {
  const ms = d.getTime(); const past = ms < T0; const soon = (ms - T0) / DAY;
  const n = past ? 34 + Math.floor(rnd() * 14) : soon < 10 ? 26 : soon < 40 ? 12 + Math.floor(rnd() * 6) : Math.floor(rnd() * 4);
  ev({ type: 'mixer', title: d.toLocaleDateString('en-US', { month: 'long' }) + ' Ladder Mixer', date: ds(ms), start: '18:30', end: '21:00', price: 20, description: MIXER_DESC, rsvps: rsvp(n), series: 'mixer' });
});
ev({ type: 'social', title: 'Ladder Launch Kickoff BBQ', date: ds(T0 - 59 * DAY), start: '17:00', end: '20:00', price: 20, memberPrice: 15, description: 'Kick off the new ' + CLUB_SHORT + (PB ? ' Pickleball' : ' Tennis') + ' Ladder! Round-robin doubles, BBQ, drinks and a quick walkthrough of the ladder app.', rsvps: rsvp(61) });
ev({ type: 'clinic', title: PB ? 'Third-Shot Drop & Reset Clinic' : 'Doubles Strategy Clinic with Jordan', date: ds(T0 - 24 * DAY), start: '09:00', end: '10:30', price: 25, memberPrice: 20, capacity: 16, description: PB ? 'Drops, resets and transition-zone patterns. 4.0 and above.' : 'Poaching, signals and serve-and-volley patterns. 4.0 and above.', rsvps: rsvp(16, appPeople.filter(p => +p.ntrp >= 4)) });
ev({ type: 'clinic', title: 'Beginner-Friendly Drill Night', date: ds(T0 + 12 * DAY), start: '18:00', end: '19:30', price: 15, memberPrice: 10, capacity: 12, description: PB ? 'Relaxed dinking drills and game play for 3.0–3.5 players. Great for new ladder members.' : 'Relaxed drills and point play for 3.0–3.5 players. Great for new ladder members.', rsvps: rsvp(9, appPeople.filter(p => +p.ntrp <= 3.5)) });
{ const y = today0.getMonth() >= 10 ? today0.getFullYear() : today0.getFullYear();
  ev({ type: 'social', title: 'Holiday Ladder Party', date: y + '-12-12', start: '18:00', end: '22:00', price: 20, memberPrice: 15, description: 'Holiday doubles round robin, dinner, drinks and the first ladder awards of the season.', rsvps: rsvp(34) }); }
[['03-27', 'Q1', 18], ['06-26', 'Q2', 6], ['09-25', 'Q3', 2], ['12-18', 'Q4', 0]].forEach(([md, q, n]) => ev({ type: 'tournament', title: q + ' Ladder Tournament', date: '2027-' + md, start: '08:00', end: '16:00', price: 45, eligibility: 'All active ladder players — seeded by current ladder rank', description: 'Quarterly ladder tournament across all five draws. Format and draw sizes will be posted closer to the date.', rsvps: rsvp(n, ranked.filter(p => !p.paper)) }));

/* ───────────── sign-ups waiting for approval ───────────── */
[['Theresa Wong', 'F', '3.5', ['Doubles', 'Mixed Doubles'], 'Weekday mornings'], ['Gabe Simmons', 'M', '4.0', ['Singles', 'Doubles'], 'Evenings'], ['Patricia Hall', 'F', '3.0', ['Social only'], 'Thursdays'], ['Leo Marchetti', 'M', '4.5', ['Singles'], 'Early mornings']]
  .forEach(([name, g, lvl, draws, avail], i) => put('signups', 's' + i, { name, email: slug(name) + '@demo.club', phone: phone(), draws, placement: draws[0] === 'Social only' ? 'Social only' : (g === 'F' ? 'Women’s draws' : 'Men’s draws'), ntrp: lvl, utr: null, avail, consent18: true, consentFee: true, status: 'pending', source: 'web', createdAt: ts(NOW - (i + 1) * 9 * 3600000) }));

/* ───────────── who you're viewing as ───────────── */
const member = ranked.filter(p => p.gender === 'F' && p.singles && p.doubles && p.active && !p.paper).sort((a, b) => b._skill - a._skill)[6] || ranked[5];
const social = players.find(p => p.social);
const VIEWERS = [[jordan._id, 'Jordan Boyls (admin)', 'admin'], [member._id, member.name + ' (member)', 'member'], [social._id, social.name + ' (social member)', 'social']];
let viewAs = jordan._id;
try { const v = sessionStorage.getItem('demoViewAs'); const hit = VIEWERS.find(x => x[2] === v); if (hit) viewAs = hit[0]; } catch (e) {}
authUser = { email: viewAs };

/* ───────────── sample phone notifications (demo only) ─────────────
   Shows what members would see on their lock screen once push
   notifications are switched on. Some add the matching item to the
   data so tapping the notification lands on something real. */
const meP = players.find(p => p._id === viewAs);
const nm = p => p.name.split(' ')[0] + ' ' + p.name.split(' ')[1][0] + '.';
const nextEvent = type => Object.entries(store.events).map(([id, e]) => Object.assign({ id }, e)).filter(e => e.type === type && new Date(e.date + 'T23:59:00').getTime() >= NOW).sort((a, b) => a.date < b.date ? -1 : 1)[0];
const whenTxt = e => new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const go = (page, after) => () => { const btn = document.getElementById('nav' + page); if (window.goPage && btn) window.goPage(page, btn); if (after) setTimeout(after, 60); window.scrollTo(0, 0); };
const adminTab = (tab, i) => () => { const t = document.querySelectorAll('#adminTabs .tab')[i]; if (window.switchAdmin && t) window.switchAdmin(tab, t); };
const rival = (t, who) => near(ranked.filter(p => inDraw(p, t) && p.active && !p.paper && p !== who), who);
let nSeq = 0;
const NOTES_FOR = {
  admin: [
    () => { const n = 'Sarah Delgado'; docRef('signups', 'live' + (++nSeq)).set({ name: n, email: 'sarah.delgado@demo.club', phone: '(916) 555-2741', draws: ['Singles', 'Doubles'], placement: 'Women’s draws', ntrp: '3.5', utr: null, avail: 'Weekday evenings', consent18: true, consentFee: true, status: 'pending', source: 'web', createdAt: ts(Date.now()) });
      return { title: 'New ladder sign-up', body: n + ' · 3.5 · Women’s Singles & Doubles. Tap to approve.', act: go('Admin', adminTab('signups', 0)) }; },
    () => { const d = (Object.values(store.matches).find(m => m.status === 'disputed')) || {}; const a = players.find(p => p._id === (d.confirmedBy || d.p2)) || {};
      return { title: 'Score disputed', body: (a.name || 'A member') + ' disputed a ' + (d.score || '') + ' result. Tap to review.', act: go('Admin', adminTab('matches', 2)) }; },
    () => { const e = nextEvent('mixer'); return { title: (e ? e.rsvps.length : 26) + ' going to Friday’s mixer', body: (e ? e.title : 'Ladder Mixer') + ' · 3 new sign-ups today', act: go('Events') }; }
  ],
  member: [
    () => { const t = meP.gender === 'F' ? 'ws' : 'ms'; const r = rival(t, meP);
      docRef('challenges', 'live' + (++nSeq)).set({ from: r._id, to: meP._id, ladder: t, date: ds(T0 + 3 * DAY), message: 'Saturday 9am? I can book court 4.', status: 'pending', createdAt: ts(Date.now()) });
      return { title: 'You’ve been challenged 🎾', body: nm(r) + ' challenged you in ' + (t === 'ws' ? 'Women’s' : 'Men’s') + ' Singles. Tap to accept.', act: go('Home') }; },
    () => { const t = meP.gender === 'F' ? 'wd' : 'md'; const pool = ranked.filter(p => inDraw(p, t) && p.active && !p.paper && p !== meP); const pa = near(pool, meP), o1 = near(pool.filter(p => p !== pa), meP), o2 = near(pool.filter(p => p !== pa && p !== o1), o1);
      docRef('matches', 'live' + (++nSeq)).set({ p1: o1._id, p1Partner: o2._id, p2: meP._id, p2Partner: pa._id, ladder: t, score: SC.note, winner: o1._id, date: ds(T0), submittedBy: o1._id, status: 'pending', createdAt: ts(Date.now()) });
      return { title: 'Confirm your score', body: nm(o1) + ' entered ' + SC.note + ' for today’s doubles. Confirm within 48 hours.', act: go('Home') }; },
    () => { const e = nextEvent('mixer'); return { title: 'Ladder Mixer ' + (e ? whenTxt(e) : 'this Friday'), body: (e ? e.title : 'Ladder Mixer') + ' · 6:30 PM · $20. ' + (e ? e.rsvps.length : 26) + ' members going.', act: go('Events') }; }
  ],
  social: [
    () => { const e = nextEvent('social'); return { title: 'New event posted', body: (e ? e.title + ' · ' + whenTxt(e) : 'Holiday Ladder Party') + '. Member price $15.', act: go('Events') }; },
    () => { const r = rival('wd', meP.gender === 'F' ? meP : ranked.find(p => p.gender === 'F')) || ranked[0]; return { title: 'New hitting partner post', body: nm(r) + ' is looking for a hit at your level this week.', act: go('Practice') }; },
    () => { const e = nextEvent('mixer'); return { title: 'Ladder Mixer ' + (e ? whenTxt(e) : 'this Friday'), body: 'Drop-in point play, food and drinks · 6:30 PM · $20.', act: go('Events') }; }
  ]
};
const myNotes = viewAs === jordan._id ? NOTES_FOR.admin : meP && meP.social ? NOTES_FOR.social : NOTES_FOR.member;
let nIdx = 0, hideT = null;
function showNote(){
  let el = document.getElementById('demoToast');
  if (!el) {
    el = document.createElement('div'); el.id = 'demoToast'; el.setAttribute('role', 'status');
    el.innerHTML = '<img src="' + ROOT + 'icon-192.png" alt=""><div class="dt-main"><div class="dt-head"><span>GOLD RIVER LADDER</span><span>now</span></div><div class="dt-title"></div><div class="dt-body"></div></div>';
    document.body.appendChild(el);
    let sy = null;
    el.addEventListener('touchstart', e => { sy = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchmove', e => { if (sy != null && e.touches[0].clientY - sy < -25) { el.classList.remove('show'); sy = null; } }, { passive: true });
  }
  const n = myNotes[nIdx % myNotes.length](); nIdx++;
  el.querySelector('.dt-title').textContent = fx(n.title); el.querySelector('.dt-body').textContent = fx(n.body);
  el.onclick = () => { el.classList.remove('show'); n.act(); };
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(hideT); hideT = setTimeout(() => el.classList.remove('show'), 8000);
}
function notesUI(){
  const row = document.createElement('div'); row.className = 'db-row';
  row.innerHTML = '<button type="button" id="demoNotify">🔔 Show a notification</button>';
  document.getElementById('demoBanner').appendChild(row);
  document.getElementById('demoNotify').addEventListener('click', showNote);
  const st = document.createElement('style');
  st.textContent = '#demoNotify{background:#1a1200;color:#f2c14e;border:0;border-radius:6px;padding:4px 10px;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap}' +
    '#demoToast{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 10px);transform:translate(-50%,-160%);width:min(400px,calc(100% - 20px));display:flex;gap:11px;align-items:flex-start;padding:11px 13px;border-radius:18px;background:rgba(245,245,247,.86);color:#111;-webkit-backdrop-filter:blur(20px) saturate(1.6);backdrop-filter:blur(20px) saturate(1.6);box-shadow:0 10px 32px rgba(0,0,0,.35);z-index:400;cursor:pointer;transition:transform .45s cubic-bezier(.2,.9,.25,1.15)}' +
    '#demoToast.show{transform:translate(-50%,0)}#demoToast img{width:38px;height:38px;border-radius:9px;flex:none}#demoToast .dt-main{min-width:0;flex:1}' +
    '#demoToast .dt-head{display:flex;justify-content:space-between;font-size:11px;letter-spacing:.4px;color:#666;margin-bottom:2px}#demoToast .dt-title{font-weight:700;font-size:14.5px;line-height:1.3}#demoToast .dt-body{font-size:13.5px;line-height:1.35;color:#222}' +
    '@media print{#demoToast,#demoNotify{display:none!important}}';
  document.head.appendChild(st);
  // first one shows by itself shortly after the app opens (once per viewer per visit)
  const nKey = 'demoNoteShown-' + (PB ? 'pb-' : '') + viewAs; let seen = false; try { seen = sessionStorage.getItem(nKey) === '1'; sessionStorage.setItem(nKey, '1'); } catch (e) {}
  if (!seen) setTimeout(showNote, 5000);
}

window.__demo = { players: players.length, matches: matches.length, store, showNote };

/* ───────────── banner ───────────── */
function banner(){
  if (document.getElementById('demoBanner')) return;
  const b = document.createElement('div'); b.id = 'demoBanner';
  b.innerHTML = '<div class="db-row"><span class="db-tag">DEMO DATA</span><span class="db-txt">Made-up players and results. Changes reset when you reload.</span></div>' +
    '<div class="db-row"><label for="demoSport">Sport</label><select id="demoSport"><option value="tennis"' + (PB ? '' : ' selected') + '>🎾 Tennis</option><option value="pickleball"' + (PB ? ' selected' : '') + '>🏓 Pickleball</option></select></div>' +
    '<div class="db-row"><label for="demoViewAs">Viewing as</label><select id="demoViewAs">' + VIEWERS.map(([id, label, role]) => '<option value="' + role + '"' + (id === viewAs ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></div>';
  document.body.insertBefore(b, document.body.firstChild);
  document.getElementById('demoViewAs').addEventListener('change', e => { try { sessionStorage.setItem('demoViewAs', e.target.value); } catch (x) {} location.hash = ''; location.reload(); });
  document.getElementById('demoSport').addEventListener('change', e => { location.href = ROOT + 'demo/' + (e.target.value === 'pickleball' ? 'pickleball/' : ''); });
  const st = document.createElement('style');
  st.textContent = '#demoBanner{background:#f2c14e;color:#1a1200;padding:6px max(12px,env(safe-area-inset-right,0px)) 6px max(12px,env(safe-area-inset-left,0px));font-size:12.5px;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;justify-content:space-between;position:relative;z-index:150}' +
    '#demoBanner .db-row{display:flex;align-items:center;gap:8px;min-width:0}#demoBanner .db-tag{font-weight:800;letter-spacing:1px;background:#1a1200;color:#f2c14e;padding:2px 7px;border-radius:4px;font-size:11px;flex:none}' +
    '#demoBanner .db-txt{font-weight:500}#demoBanner label{font-weight:700;white-space:nowrap}#demoBanner select{width:auto;max-width:210px;padding:3px 8px;font-size:12.5px;background:#fff7dc;color:#1a1200;border:1px solid #c9a23a;border-radius:6px}' +
    '@media print{#demoBanner{display:none!important}}' +
    '.logo-text{white-space:normal!important;font-size:15.5px!important;line-height:1.05!important}';   /* longer club name: wrap onto two lines */
  document.head.appendChild(st);
  notesUI();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
})();
