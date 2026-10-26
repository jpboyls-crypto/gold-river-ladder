/* ═══════════════════════════════════════════════════════════════════════════
   Gold River Tennis Ladder — DEMO MODE
   Stands in for Firebase with an in-memory database filled with made-up
   players, two months of matches, events and more. Nothing here talks to the
   real database; every change is lost on reload.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
const DAY = 86400000;

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
const UTR = { '3.0': 3.4, '3.5': 4.5, '4.0': 5.8, '4.5': 7.1, '5.0': 8.5 };
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
    singles: ranked && (opts.singles != null ? opts.singles : rnd() < .62),
    doubles: ranked && (opts.doubles != null ? opts.doubles : rnd() < .78),
    mixed:   ranked && (opts.mixed   != null ? opts.mixed   : rnd() < .58),
    utrSingles: rnd() < .7 ? +(UTR[lvl] + rnd() * 1.2 - .5).toFixed(2) : null,
    utrDoubles: rnd() < .6 ? +(UTR[lvl] + .3 + rnd() * 1.2 - .5).toFixed(2) : null,
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
jordan.utrSingles = 9.24; jordan.utrDoubles = 9.8; jordan.availability = 'Evenings after lessons';
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

const SCORES_CLOSE = ['7-5, 6-4', '6-4, 7-6', '4-6, 6-3, 10-7', '6-3, 4-6, 10-8', '7-6, 6-4', '6-4, 6-4', '3-6, 6-4, 10-6'];
const SCORES_EASY = ['6-2, 6-1', '6-1, 6-3', '6-3, 6-2', '6-0, 6-2', '6-2, 6-3'];
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
const DRAW_W = [['ms', 24], ['ws', 15], ['md', 23], ['wd', 16], ['mx', 22]];
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
  m.p1 = opp._id; m.p2 = jordan._id; m.winner = opp._id; m.submittedBy = opp._id; m.score = '6-4, 3-6, 10-8'; }
matches.forEach(([id, m]) => put('matches', id, m));
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
  // one expired, for the admin "needs attention" list
  const x = pick(pool), y = near(pool, x); chal(x, y, 'ms', 'accepted', 9 * 24 + 5, ''); }
for (let i = 0; i < 40; i++) { const t = pick(['ms', 'ws']); const pool = ranked.filter(p => inDraw(p, t)); const a = pick(pool), b = near(pool, a); put('challenges', 'c' + (++cid), { from: a._id, to: b._id, ladder: t, date: '', message: '', status: 'played', createdAt: ts(T0 - (10 + Math.floor(rnd() * 48)) * DAY) }); }

/* ───────────── practice board ───────────── */
const FORMATS = ['hit', 'drill', 'singles', 'doubles'];
const NOTES = ['Looking for a steady rally partner, 45–60 min.', 'Happy to feed balls and work on volleys.', 'Need 2 more for a practice doubles set.', 'Working on my serve — anyone want to do serve & return?', 'Early hit before work, about an hour.', 'Practice set, no pressure.', 'Need a fourth for Saturday doubles!', 'Lob and overhead drills, all welcome.', 'Coming back from injury, easy hitting please.', 'Want to play some tiebreaks.'];
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
function ev(o){ put('events', 'e' + (++eid), Object.assign({ location: 'Gold River Sports Club', eligibility: '', rsvpOn: true, capacity: null, price: null, memberPrice: null, createdBy: 'jpboyls@gmail.com', createdAt: ts(T0 - 70 * DAY) }, o)); }
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
  ev({ type: 'mixer', title: d.toLocaleDateString('en-US', { month: 'long' }) + ' Ladder Mixer', date: ds(ms), start: '18:30', end: '21:00', price: 10, description: MIXER_DESC, rsvps: rsvp(n), series: 'mixer' });
});
ev({ type: 'social', title: 'Ladder Launch Kickoff BBQ', date: ds(T0 - 59 * DAY), start: '17:00', end: '20:00', price: 20, memberPrice: 15, description: 'Kick off the new Gold River Tennis Ladder! Round-robin doubles, BBQ, drinks and a quick walkthrough of the ladder app.', rsvps: rsvp(61) });
ev({ type: 'clinic', title: 'Doubles Strategy Clinic with Jordan', date: ds(T0 - 24 * DAY), start: '09:00', end: '10:30', price: 25, memberPrice: 20, capacity: 16, description: 'Poaching, signals and serve-and-volley patterns. 4.0 and above.', rsvps: rsvp(16, appPeople.filter(p => +p.ntrp >= 4)) });
ev({ type: 'clinic', title: 'Beginner-Friendly Drill Night', date: ds(T0 + 12 * DAY), start: '18:00', end: '19:30', price: 15, memberPrice: 10, capacity: 12, description: 'Relaxed drills and point play for 3.0–3.5 players. Great for new ladder members.', rsvps: rsvp(9, appPeople.filter(p => +p.ntrp <= 3.5)) });
{ const y = today0.getMonth() >= 10 ? today0.getFullYear() : today0.getFullYear();
  ev({ type: 'social', title: 'Holiday Ladder Party', date: y + '-12-12', start: '18:00', end: '22:00', price: 20, memberPrice: 15, description: 'Holiday doubles round robin, dinner, drinks and the first ladder awards of the season.', rsvps: rsvp(34) }); }
[['03-27', 'Q1', 18], ['06-26', 'Q2', 6], ['09-25', 'Q3', 2], ['12-18', 'Q4', 0]].forEach(([md, q, n]) => ev({ type: 'tournament', title: q + ' Ladder Tournament', date: '2027-' + md, start: '08:00', end: '16:00', eligibility: 'All active ladder players — seeded by current ladder rank', description: 'Quarterly ladder tournament across all five draws. Format and draw sizes will be posted closer to the date.', rsvps: rsvp(n, ranked.filter(p => !p.paper)) }));

/* ───────────── sign-ups waiting for approval ───────────── */
[['Theresa Wong', 'F', '3.5', ['Doubles', 'Mixed Doubles'], 'Weekday mornings'], ['Gabe Simmons', 'M', '4.0', ['Singles', 'Doubles'], 'Evenings'], ['Patricia Hall', 'F', '3.0', ['Social only'], 'Thursdays'], ['Leo Marchetti', 'M', '4.5', ['Singles'], 'Early mornings']]
  .forEach(([name, g, lvl, draws, avail], i) => put('signups', 's' + i, { name, email: slug(name) + '@demo.club', phone: phone(), draws, placement: draws[0] === 'Social only' ? 'Social only' : (g === 'F' ? 'Women’s draws' : 'Men’s draws'), ntrp: lvl, utr: null, avail, consent18: true, consentFee: true, status: 'pending', source: 'web', createdAt: ts(NOW - (i + 1) * 9 * 3600000) }));

/* ───────────── who you're viewing as ───────────── */
const member = ranked.filter(p => p.gender === 'F' && p.singles && p.doubles && p.active && !p.paper).sort((a, b) => b._skill - a._skill)[6] || ranked[5];
const social = players.find(p => p.social);
const VIEWERS = [[jordan._id, 'Jordan Boyls (admin)'], [member._id, member.name + ' (member)'], [social._id, social.name + ' (social member)']];
let viewAs = jordan._id;
try { const v = sessionStorage.getItem('demoViewAs'); if (VIEWERS.some(x => x[0] === v)) viewAs = v; } catch (e) {}
authUser = { email: viewAs };

window.__demo = { players: players.length, matches: matches.length, store };

/* ───────────── banner ───────────── */
function banner(){
  if (document.getElementById('demoBanner')) return;
  const b = document.createElement('div'); b.id = 'demoBanner';
  b.innerHTML = '<div class="db-row"><span class="db-tag">DEMO DATA</span><span class="db-txt">Made-up players and results. Changes reset when you reload.</span></div>' +
    '<div class="db-row"><label for="demoViewAs">Viewing as</label><select id="demoViewAs">' + VIEWERS.map(([id, label]) => '<option value="' + id + '"' + (id === viewAs ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></div>';
  document.body.insertBefore(b, document.body.firstChild);
  document.getElementById('demoViewAs').addEventListener('change', e => { try { sessionStorage.setItem('demoViewAs', e.target.value); } catch (x) {} location.hash = ''; location.reload(); });
  const st = document.createElement('style');
  st.textContent = '#demoBanner{background:#f2c14e;color:#1a1200;padding:6px max(12px,env(safe-area-inset-right,0px)) 6px max(12px,env(safe-area-inset-left,0px));font-size:12.5px;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;justify-content:space-between;position:relative;z-index:150}' +
    '#demoBanner .db-row{display:flex;align-items:center;gap:8px;min-width:0}#demoBanner .db-tag{font-weight:800;letter-spacing:1px;background:#1a1200;color:#f2c14e;padding:2px 7px;border-radius:4px;font-size:11px;flex:none}' +
    '#demoBanner .db-txt{font-weight:500}#demoBanner label{font-weight:700;white-space:nowrap}#demoBanner select{width:auto;max-width:210px;padding:3px 8px;font-size:12.5px;background:#fff7dc;color:#1a1200;border:1px solid #c9a23a;border-radius:6px}' +
    '@media print{#demoBanner{display:none!important}}';
  document.head.appendChild(st);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
})();
