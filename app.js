// ═══════════════════════════════════════════
//  GOLD RIVER TENNIS LADDER — live app
//  Firebase Auth (email link) + Firestore
// ═══════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyAOUJ9rK9QtAGfMHy7WEAI1Wl51d7VnSz0",
  authDomain: "gold-river-ladder.firebaseapp.com",
  projectId: "gold-river-ladder",
  storageBucket: "gold-river-ladder.firebasestorage.app",
  messagingSenderId: "530476423836",
  appId: "1:530476423836:web:bbcf949eac6bfeddff2b59"
};
// Admins are identified by email. Must match the list in firestore.rules.
const ADMIN_EMAILS = ['jpboyls@gmail.com','jordanb@sparetimesportsclubs.com'];

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;

// ── adult or junior ladder? junior/index.html sets window.LADDER_MODE='junior' before loading this file.
// Same code, separate data: junior collections start with jr_, and parents sign in on behalf of their kids.
const JR = window.LADDER_MODE==='junior';
const COL = n => JR ? 'jr_'+n : n;
const LADDER_NAME = JR ? 'Gold River Junior Tennis Ladder' : 'Gold River Tennis Ladder';
const SEASON_YEAR = 2027;            // junior age groups use the player's age in this year
// Extra admins for the junior app only (e.g. the Junior Coordinator). Must match jrAdmin() in firestore.rules.
const JR_ADMIN_EMAILS = [];

// Rating deltas — symmetric: every winner gets +WIN, every loser gets LOSS
const WIN = 18, LOSS = -12;
// ── ladder rules ──
const SEASON_START   = '2027-01-01'; // decay and the launch "open challenge" window are measured from here
const CONFIRM_HOURS  = 48;  // unconfirmed scores count automatically after this
const CHALLENGE_DAYS = 7;   // a challenge must be played within this many days
const DECAY_GRACE    = 30;  // days without a confirmed match before sliding starts
const DECAY_POINTS   = 10;  // points lost per week once sliding
const DECAY_CAP      = 100; // max points lost in any single idle stretch
const OPEN_DAYS      = 21;  // new members can challenge anyone in their draw for this long
const DAY = 86400000;
// Court booking (Club Automation). Opens the tennis booking page on a given day.
const BOOKING_URL = 'https://sparetime.clubautomation.com/tennis';
function bookingHref(dateStr){
  let d = dateStr ? new Date(dateStr+'T12:00:00') : new Date();
  if(isNaN(d) || d < new Date(new Date().toDateString())) d = new Date();
  const mm=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
  return `${BOOKING_URL}?date=${mm}/${dd}/${d.getFullYear()}`;
}
function bookBtn(dateStr,label){ return `<a class="btn btn-secondary btn-sm" href="${bookingHref(dateStr)}" target="_blank" rel="noopener">\u{1F4C5} ${label||'Book a court'}</a>`; }
const NTRP_BASE = {'2.5':1000,'3.0':1100,'3.5':1200,'4.0':1400,'4.5':1600,'5.0':1800,'5.0+':1800};

// ── live state (filled by Firestore listeners) ──
let state = {
  user: null,          // firebase user
  email: null,         // lowercased; the player id the app acts as (junior: the selected child)
  authEmail: null,     // the signed-in email (junior: the parent)
  kids: [],            // junior: this parent's children
  isAdmin: false,
  players: [],         // player docs, id = email
  matches: [],
  challenges: [],
  hits: [],
  signups: [],
  events: [],
  activeLadder: 'ms',
  ready: {players:false, matches:false, challenges:false, hits:false}
};
let unsubs = [];

const $ = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = e => (e||'').trim().toLowerCase();
const today = () => new Date().toISOString().split('T')[0];
const initialsOf = n => n.split(' ').filter(Boolean).map(x=>x[0]).join('').toUpperCase().slice(0,2);

// ═══════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════
function showAuth(which){
  ['authLoading','authLogin','authNotMember'].forEach(id => $(id).hidden = id!==which);
  $('appMain').hidden = which!==null;
  $('bottomNav').hidden = which!==null;
  const kb=$('kidBar'); if(kb) kb.hidden = which!==null || !(state.kids||[]).length;
}
async function sendLink(){
  const email = norm($('loginEmail').value);
  if(!/^\S+@\S+\.\S+$/.test(email)){ $('loginMsg').textContent='Please enter a valid email.'; return; }
  $('loginBtn').disabled = true; $('loginMsg').textContent = 'Sending…';
  try{
    await auth.sendSignInLinkToEmail(email, { url: location.origin + location.pathname, handleCodeInApp: true });
    try{ localStorage.setItem('ladderEmail', email); }catch(e){}
    $('loginMsg').innerHTML = isStandalone()
      ? `<b style="color:var(--green)">Check your inbox.</b> We sent a sign-in link to <b>${esc(email)}</b>. Because you opened the ladder from your home screen, copy the link instead of tapping it \u2014 see below. (Check spam if it's not there in a minute.)`
      : `<b style="color:var(--green)">Check your inbox.</b> We sent a sign-in link to <b>${esc(email)}</b>. Open it on this phone and you'll be signed in. (Check spam if it's not there in a minute.)`;
    showPasteBox();
  }catch(e){
    $('loginMsg').textContent = 'Could not send the link: ' + (e.message||e.code);
    $('loginBtn').disabled = false;
  }
}
async function completeLinkSignIn(){
  if(!auth.isSignInWithEmailLink(location.href)) return false;
  let email = null;
  try{ email = localStorage.getItem('ladderEmail'); }catch(e){}
  if(!email) email = window.prompt('Confirm the email you used to request the link:');
  if(!email) return false;
  try{
    await auth.signInWithEmailLink(norm(email), location.href);
    try{ localStorage.removeItem('ladderEmail'); }catch(e){}
    history.replaceState(null,'',location.origin+location.pathname);
    return true;
  }catch(e){
    showAuth('authLogin');
    $('loginMsg').textContent = 'That link didn’t work (' + (e.code||'') + '). Request a fresh one below.';
    return false;
  }
}
// Home-screen web apps on iPhone don't receive links tapped in Mail/Gmail
// (those open in Safari), so let members paste the link in instead.
function isStandalone(){ try{ return navigator.standalone===true || matchMedia('(display-mode: standalone)').matches; }catch(e){ return false; } }
function showPasteBox(){ $('pasteBox').hidden=false; $('pasteToggle').hidden=true; }
async function signInWithPasted(){
  const link=($('pasteLink').value||'').trim();
  let email=norm($('loginEmail').value);
  if(!email){ try{ email=localStorage.getItem('ladderEmail')||''; }catch(e){} }
  if(!email){ $('loginMsg').textContent='Enter your email above first, then paste the link.'; return; }
  if(!link||!auth.isSignInWithEmailLink(link)){ $('loginMsg').innerHTML='<span style="color:var(--red)">That doesn\u2019t look like a sign-in link.</span> Press and hold the link in the email, choose Copy Link, and paste the whole thing.'; return; }
  $('loginMsg').textContent='Signing in\u2026';
  try{
    await auth.signInWithEmailLink(email, link);
    try{ localStorage.removeItem('ladderEmail'); }catch(e){}
    $('pasteLink').value='';
  }catch(e){
    const why = e.code==='auth/invalid-email' ? 'the email above doesn\u2019t match the one the link was sent to'
             : (e.code==='auth/invalid-action-code'||e.code==='auth/expired-action-code') ? 'that link has expired or was already used \u2014 request a fresh one'
             : (e.message||e.code);
    $('loginMsg').innerHTML='<span style="color:var(--red)">Couldn\u2019t sign in:</span> '+esc(why)+'.';
  }
}
function signOut(){ stopListeners(); auth.signOut(); }

auth.onAuthStateChanged(async user => {
  if(!user){ state.user=null; state.email=null; state.authEmail=null; state.kids=[]; state.isAdmin=false; stopListeners(); showAuth('authLogin'); return; }
  state.user = user; state.authEmail = norm(user.email); state.email = state.authEmail;
  state.isAdmin = ADMIN_EMAILS.includes(state.authEmail) || (JR && JR_ADMIN_EMAILS.includes(state.authEmail));
  showAuth('authLoading');
  startListeners();
});
completeLinkSignIn();

// ── self-update ──
// GitHub Pages lets phones reuse a cached page for ~10 minutes, and home-screen apps hold on longer.
// On open (and whenever the app comes back to the foreground) fetch the live index.html, bypassing the
// cache; if it references a newer app.js version, reload onto a fresh URL so the new version loads.
function currentVersion(){ const sc=[...document.scripts].find(x=>/app\.js\?v=/.test(x.src)); return sc?sc.src.split('v=')[1]:''; }
async function checkForUpdate(){
  try{
    if(location.protocol==='file:') return;
    const r=await fetch('index.html?check='+Date.now(),{cache:'no-store'}); if(!r.ok) return;
    const m=(await r.text()).match(/app\.js\?v=([\w-]+)/); if(!m) return;
    const live=m[1], mine=currentVersion();
    if(mine&&live!==mine){
      if(isSignInLinkPending()) return; // never interrupt an email-link sign-in
      // loop guard: only try once per version per session
      try{ if(sessionStorage.getItem('triedUpdate')===live) return; sessionStorage.setItem('triedUpdate',live); }catch(e){ return; }
      location.replace(location.pathname.replace(/[^/]*$/,'')+'index.html?u='+live+location.hash);
    }
  }catch(e){}
}
function isSignInLinkPending(){ try{ return auth.isSignInWithEmailLink(location.href); }catch(e){ return false; } }
checkForUpdate();
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') checkForUpdate(); });
(function(){ try{ const e=localStorage.getItem('ladderEmail'); if(e) $('loginEmail').value=e; }catch(_){} if(isStandalone()) showPasteBox(); })();

// ═══════════════════════════════════════════
//  FIRESTORE LISTENERS
// ═══════════════════════════════════════════
function stopListeners(){ unsubs.forEach(u=>u()); unsubs=[]; state.players=[];state.matches=[];state.challenges=[];state.hits=[];state.signups=[];state.events=[]; Object.keys(state.ready).forEach(k=>state.ready[k]=false); }
function startListeners(){
  stopListeners();
  const onErr = name => e => { console.error(name, e); if(e.code==='permission-denied'){ onNotMember(); } };
  unsubs.push(db.collection(COL('players')).onSnapshot(s=>{ state.players=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.players=true; afterData(); }, onErr('players')));
  unsubs.push(db.collection(COL('matches')).orderBy('date','desc').onSnapshot(s=>{ state.matches=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.matches=true; afterData(); }, onErr('matches')));
  unsubs.push(db.collection(COL('challenges')).onSnapshot(s=>{ state.challenges=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.challenges=true; afterData(); }, onErr('challenges')));
  unsubs.push(db.collection(COL('events')).onSnapshot(s=>{ state.events=s.docs.map(d=>({id:d.id,...d.data()})); if(booted) rerender(); }, e=>{ console.warn('events unavailable', e); }));
  if(JR) state.ready.hits=true;   // no Practice board in the junior app (and no jr_hits rules)
  else unsubs.push(db.collection(COL('hits')).onSnapshot(s=>{ state.hits=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.hits=true; afterData(); }, onErr('hits')));
  if(state.isAdmin){
    unsubs.push(db.collection(COL('signups')).onSnapshot(s=>{ state.signups=s.docs.map(d=>({id:d.id,...d.data()})); renderSignupBadge(); if(currentPage==='Admin') renderAdmin(); }, onErr('signups')));
  }
}
let booted=false, currentPage='Home';
function onNotMember(){ stopListeners(); showAuth('authNotMember'); $('notMemberText').innerHTML = JR
  ? `<b>${esc(state.authEmail)}</b> isn’t linked to a junior player yet. If you just signed your child up, Jordan will add them shortly and text or email you when they’re in. Otherwise sign up first, or check with Jordan.`
  : `<b>${esc(state.email)}</b> isn’t on the member list yet. If you just signed up, Jordan will add you shortly and text or email you when you’re in. Otherwise sign up first, or check with Jordan.`; }
// ── junior: a parent signs in and acts for one child at a time ──
function myKids(){ const a=state.authEmail; return state.players.filter(p=>!p.paper&&a&&(p.parent===a||p.parent2===a)).sort((x,y)=>x.name.localeCompare(y.name)); }
function pickKid(){
  const kids=myKids(); state.kids=kids;
  if(!kids.length){ state.email=state.authEmail; renderKidBar(); return; }
  let id=null; try{ id=localStorage.getItem('jrKid'); }catch(e){}
  if(!kids.some(k=>k.id===id)) id=kids.some(k=>k.id===state.email)?state.email:kids[0].id;
  state.email=id; renderKidBar();
}
function renderKidBar(){
  let bar=$('kidBar');
  if(!bar){ bar=document.createElement('div'); bar.id='kidBar'; bar.className='kid-bar'; const tb=document.querySelector('.topbar'); tb.parentNode.insertBefore(bar,tb.nextSibling); }
  const kids=state.kids||[];
  bar.hidden=!kids.length||!booted&&$('appMain').hidden;
  if(!kids.length){ bar.innerHTML=''; return; }
  bar.innerHTML=kids.length===1
    ?`<span>Playing as</span><b>${esc(kids[0].name)}</b>`
    :`<label for="kidSel">Playing as</label><select id="kidSel" onchange="switchKid(this.value)">${kids.map(k=>`<option value="${esc(k.id)}"${k.id===state.email?' selected':''}>${esc(k.name)}</option>`).join('')}</select>`;
}
function switchKid(id){
  try{ localStorage.setItem('jrKid',id); }catch(e){}
  state.email=id; renderKidBar(); rerender();
  if(currentPage==='Challenge') initChallengePage(false);
  toast('Now playing as '+displayName(id).split(' ')[0]);
}
function afterData(){
  if(!Object.values(state.ready).every(Boolean)) return;
  if(JR) pickKid();
  if(!me() && !state.isAdmin){ onNotMember(); return; }
  if(!booted){
    booted=true;
    showAuth(null);
    $('adminBadge').hidden = !state.isAdmin;
    $('helpBtn').hidden = false;
    $('navAdmin').hidden = !state.isAdmin;
    let h = (location.hash||'').replace('#','');
    const map={home:'Home',ladder:'Ladder',challenge:'Challenge',practice:'Practice',events:'Events',rules:'Rules',profile:'Profile',admin:'Admin',install:'Install'};
    if(!map[h]) h = (state.isAdmin && !me()) ? 'admin' : 'home';
    goPage(map[h], $('nav'+map[h]));
  } else {
    rerender();
  }
}
function rerender(){
  if(state.isAdmin) renderMatchBadge();
  if(currentPage==='Home') renderHome();
  if(currentPage==='Ladder') renderLadder();
  if(currentPage==='Challenge') initChallengePage(true);
  if(currentPage==='Practice') renderPractice();
  if(currentPage==='Events') renderEvents();
  if(currentPage==='Rules') renderRules();
  if(currentPage==='Profile') renderProfile();
  if(currentPage==='Admin') renderAdmin();
}

// ═══════════════════════════════════════════
//  DATA HELPERS (ratings derived from matches)
// ═══════════════════════════════════════════
function isPaper(p){ return !!(p&&p.paper); }
function getPlayer(id){ return state.players.find(p=>p.id===id) }
function me(){ return getPlayer(state.email) }
function displayName(id){ const p=getPlayer(id); return p?p.name:(id||'Unknown'); }

const ADULT_LADDERS={
  ms:{label:"Men's Singles",  short:"M Singles", flag:'singles',base:'baseSingles',utr:'utrSingles',gender:'M',color:'var(--accent-hi)',chip:'chip-blue'},
  ws:{label:"Women's Singles",short:"W Singles", flag:'singles',base:'baseSingles',utr:'utrSingles',gender:'F',color:'var(--accent-hi)',chip:'chip-blue'},
  md:{label:"Men's Doubles",  short:"M Doubles", flag:'doubles',base:'baseDoubles',utr:'utrDoubles',gender:'M',color:'var(--green)',chip:'chip-green',dbl:true},
  wd:{label:"Women's Doubles",short:"W Doubles", flag:'doubles',base:'baseDoubles',utr:'utrDoubles',gender:'F',color:'var(--green)',chip:'chip-green',dbl:true},
  mx:{label:'Mixed Doubles',  short:'Mixed',     flag:'mixed',  base:'baseMixed',  utr:'utrDoubles',gender:null,color:'var(--purple)',chip:'chip-purple',dbl:true},
};
// Junior singles: one division per player, by ball color and age group. Junior Doubles is open to everyone who opts in.
const jrDiv=(div,label,short,color,chip)=>({label,short,div,flag:'singles',base:'baseSingles',utr:'utrSingles',color,chip});
const JR_LADDERS={
  o10:jrDiv('o10','Orange Ball 10U','Orange 10U','var(--gold)','chip-gold'),
  g12:jrDiv('g12','Green Ball 12U','Green 12U','var(--green)','chip-green'),
  b14:jrDiv('b14','Boys 14U','Boys 14U','var(--accent-hi)','chip-blue'),
  g14:jrDiv('g14','Girls 14U','Girls 14U','var(--purple)','chip-purple'),
  b16:jrDiv('b16','Boys 16U','Boys 16U','var(--accent-hi)','chip-blue'),
  g16:jrDiv('g16','Girls 16U','Girls 16U','var(--purple)','chip-purple'),
  b18:jrDiv('b18','Boys 18U','Boys 18U','var(--accent-hi)','chip-blue'),
  g18:jrDiv('g18','Girls 18U','Girls 18U','var(--purple)','chip-purple'),
  jd:{label:'Junior Doubles',short:'Doubles',flag:'doubles',base:'baseDoubles',utr:'utrDoubles',gender:null,color:'var(--green)',chip:'chip-green',dbl:true},
};
const LADDERS=JR?JR_LADDERS:ADULT_LADDERS;
const LADDER_ORDER=JR?['o10','g12','b14','g14','b16','g16','b18','g18','jd']:['ms','ws','md','wd','mx'];
const JR_DIVISIONS=['o10','g12','b14','g14','b16','g16','b18','g18'];
const BALLS=['Red','Orange','Green','Yellow'];
state.activeLadder=LADDER_ORDER[0];
function isDoubles(t){ return !!(LADDERS[t]&&LADDERS[t].dbl) }
function inLadder(p,t){ const L=LADDERS[t]; if(!L) return false; if(L.div) return p.division===L.div; return !!p[L.flag]&&(!L.gender||p.gender===L.gender); }
// level shown next to a name: NTRP for adults, ball color for juniors
function lvl(p){ return JR?(p.ntrp?esc(p.ntrp)+' ball':'Junior'):'NTRP '+esc(p.ntrp); }
// starting division from birth year, gender and ball color (age = age during SEASON_YEAR)
function suggestDivision(birthYear,gender,ball){
  if(ball==='Red'||ball==='Orange') return 'o10';
  if(ball==='Green') return 'g12';
  const age=SEASON_YEAR-Number(birthYear||0), g=gender==='F'?'g':'b';
  return g+(age<=14?'14':age<=16?'16':'18');
}
function ladderLabel(t){ return LADDERS[t]?LADDERS[t].label:t }
function ladderColor(t){ return LADDERS[t].color }
function playedIn(x,id){ return x.p1===id||x.p2===id||x.p1Partner===id||x.p2Partner===id }
function wonBy(x,id){ const side1=id===x.p1||id===x.p1Partner; return side1?x.winner===x.p1:x.winner===x.p2; }
function getUTR(p,t){ return p[LADDERS[t].utr] }
// ── dates ──
function tsMs(ts){ if(!ts) return Date.now(); if(typeof ts.seconds==='number') return ts.seconds*1000; const d=new Date(ts); return isNaN(d)?Date.now():d.getTime(); }
function dayMs(d){ const [y,m,dd]=(d||'').split('-').map(Number); return new Date(y,(m||1)-1,dd||1).getTime(); }
function fmtShort(ms){ return new Date(ms).toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
// RANK_AS_OF lets the app recompute the ladder as it stood on an earlier date (used for the ▲▼ movement
// on printed standings). null = now.
let RANK_AS_OF=null;
function nowMs(){ return RANK_AS_OF==null?Date.now():RANK_AS_OF; }
function inWindow(m){ return RANK_AS_OF==null||dayMs(m.date)<=RANK_AS_OF; }
function seasonStarted(){ return nowMs()>=dayMs(SEASON_START); }

// ── score confirmation ──
// Old matches have no status: they count. Pending ones count once confirmed, or automatically after CONFIRM_HOURS.
function matchState(m){
  if(!m.status||m.status==='confirmed') return 'confirmed';
  if(m.status==='disputed') return 'disputed';
  return (Date.now()-tsMs(m.createdAt) >= CONFIRM_HOURS*3600000) ? 'confirmed' : 'pending';
}
function counts(m){ return matchState(m)==='confirmed'; }
function countedMatches(){ return state.matches.filter(counts); }
function confirmDeadline(m){ return tsMs(m.createdAt)+CONFIRM_HOURS*3600000; }
function onOpposingSide(m,id){ const subSide1=m.submittedBy===m.p1||m.submittedBy===m.p1Partner; return subSide1?(m.p2===id||m.p2Partner===id):(m.p1===id||m.p1Partner===id); }

// ── activity / decay ──
function joinMs(p){ return p.createdAt?tsMs(p.createdAt):dayMs('2026-10-24'); }
// whole calendar days, immune to daylight-saving shifts
function dayNum(ms){ const d=new Date(ms); return Math.round(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY); }
// a match keeps you active — except losing by forfeit (dodging a challenge shouldn't reset your clock)
function activityFor(m,id){ return counts(m)&&inWindow(m)&&playedIn(m,id)&&!(m.forfeit&&!wonBy(m,id)); }
function lastActivityMs(p){
  let last=Math.max(joinMs(p),dayMs(SEASON_START));
  for(const m of state.matches){ if(!activityFor(m,p.id)) continue; last=Math.max(last,dayMs(m.date)); }
  for(const h of (p.holds||[])) last=Math.max(last,dayMs(h.to));
  return last;
}
// Points lost to inactivity. Every idle stretch since the season started (between join, each counted
// match, and today) costs DECAY_POINTS per week after DECAY_GRACE days, capped at DECAY_CAP per stretch.
// Playing again stops the slide but does not refund points already lost.
function decayPenalty(p){
  if(!seasonStarted()||p.active===false) return 0;
  const start=Math.max(joinMs(p),dayMs(SEASON_START));
  const pts=[start];
  for(const m of state.matches){ if(!activityFor(m,p.id)) continue; const d=dayMs(m.date); if(d>start) pts.push(d); }
  pts.sort((a,b)=>a-b); pts.push(nowMs());
  const holds=(p.holds||[]).map(h=>[dayNum(dayMs(h.from)),dayNum(dayMs(h.to))]);
  let pen=0;
  for(let i=1;i<pts.length;i++){
    const a=dayNum(pts[i-1]), b=dayNum(pts[i]);
    let held=0; for(const [hf,ht] of holds){ held+=Math.max(0,Math.min(b,ht)-Math.max(a,hf)); }
    const gap=b-a-held;
    if(gap>DECAY_GRACE) pen+=Math.min(DECAY_CAP,(Math.floor((gap-DECAY_GRACE-1)/7)+1)*DECAY_POINTS);
  }
  return pen;
}
function decayStartsMs(p){ return lastActivityMs(p)+(DECAY_GRACE+1)*DAY; }

// ── new-member open-challenge window ──
function openUntilMs(p){ return Math.max(joinMs(p),dayMs(SEASON_START))+OPEN_DAYS*DAY; }
function inOpenWindow(p){ return Date.now()<openUntilMs(p); }
function isNewMember(p){ return Date.now()-joinMs(p)<OPEN_DAYS*DAY; }

function getRating(p,t){
  const L=LADDERS[t]; let r=p[L.base]||NTRP_BASE[p.ntrp]||1200;
  for(const m of state.matches){ if(m.ladder!==t||!playedIn(m,p.id)||!counts(m)||!inWindow(m)) continue; r += wonBy(m,p.id)?WIN:LOSS; }
  return r-decayPenalty(p);
}
function record(p){ let w=0,l=0; for(const m of state.matches){ if(!playedIn(m,p.id)||!counts(m)||!inWindow(m)) continue; wonBy(m,p.id)?w++:l++; } return {w,l}; }
function playerLadders(p){ return LADDER_ORDER.filter(t=>inLadder(p,t)); }
function getRanked(t){
  const L=LADDERS[t];
  return state.players.filter(p=>p.active!==false&&inLadder(p,t)&&(RANK_AS_OF==null||joinMs(p)<=RANK_AS_OF))
    .map(p=>({p,r:getRating(p,t)})).sort((a,b)=>b.r-a.r||a.p.name.localeCompare(b.p.name)).map(x=>x.p);
}
function ranksAsOf(t,ms){ RANK_AS_OF=ms; try{ return getRanked(t).map(p=>p.id); } finally{ RANK_AS_OF=null; } }
function rankIn(p,t){ const i=getRanked(t).findIndex(x=>x.id===p.id); return i<0?null:i+1 }
function matchLine(match,viewerId){
  const mine=match.p1===viewerId||match.p1Partner===viewerId;
  const [a,b,c,d]=mine?[match.p1,match.p1Partner,match.p2,match.p2Partner]:[match.p2,match.p2Partner,match.p1,match.p1Partner];
  if(!b&&!d) return `vs ${esc(displayName(c))}`;
  const partner=a===viewerId?b:a;
  return `w/ ${esc(displayName(partner))} vs ${esc(displayName(c))}${d?' &amp; '+esc(displayName(d)):''}`;
}
function pairingStats(ladder){
  const map={};
  state.matches.filter(x=>x.ladder===ladder&&x.p1Partner&&x.p2Partner&&counts(x)).forEach(x=>{
    [[x.p1,x.p1Partner,x.winner===x.p1],[x.p2,x.p2Partner,x.winner===x.p2]].forEach(([a,b,won])=>{
      const key=[a,b].sort().join('|');
      if(!map[key]) map[key]={ids:[a,b],wins:0,losses:0};
      won?map[key].wins++:map[key].losses++;
    });
  });
  return Object.values(map).map(s=>({...s,played:s.wins+s.losses,pct:s.wins/(s.wins+s.losses)}))
    .sort((a,b)=>b.wins-a.wins||b.pct-a.pct||b.played-a.played);
}

// ═══════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════
function goPage(name,btn){
  currentPage=name;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $('page'+name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  rerender();
  if(name==='Challenge') initChallengePage(false);
  try{ history.replaceState(null,'','#'+name.toLowerCase()); }catch(e){}
  window.scrollTo(0,0);
}

// ═══════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════
function renderHome(){
  renderHomeEvent();
  renderHomeAwards();
  const m=me();
  if(!m){ // admin without a player record
    $('heroName').textContent='Admin'; $('heroRank').textContent='You’re signed in as the ladder admin.';
    $('heroWins').textContent=state.players.length; $('heroLosses').textContent=state.matches.length;
    $('heroRating').textContent='—'; $('heroPending').textContent=state.signups.filter(s=>s.status==='pending').length;
    $('pendingList').innerHTML=`<div class="empty"><div class="empty-title">Manage the ladder from the Admin tab</div><div class="empty-sub">${JR?'Junior players, sign-ups, scores and Matchplay Days are all there.':'Add yourself as a player there if you want to compete too.'}</div></div>`;
    $('recentList').innerHTML=recentMatchesHtml(state.matches.slice(0,5),null);
    return;
  }
  const rec=record(m);
  $('heroName').textContent=m.name;
  const parts=playerLadders(m).map(t=>`#${rankIn(m,t)} ${LADDERS[t].short}`);
  $('heroRank').textContent=parts.join(' · ')||(m.social?'Social member · practice, events & member pricing':'Not enrolled in any ladder');
  $('heroWins').textContent=rec.w; $('heroLosses').textContent=rec.l;
  const firstL=playerLadders(m)[0]; $('heroRating').textContent=firstL?getRating(m,firstL):'—';
  renderHomeAlerts(m);
  const pending=state.challenges.filter(c=>isOpenChallenge(c)&&(c.to===m.id||c.from===m.id)).sort((a,b)=>tsMs(a.createdAt)-tsMs(b.createdAt));
  $('heroPending').textContent=pending.length;
  const pList=$('pendingList');
  if(!pending.length){
    pList.innerHTML=`<div class="empty"><div class="empty-icon">🎾</div><div class="empty-title">No open challenges</div><div class="empty-sub">Issue a challenge from the Play tab.</div></div>`;
  } else {
    pList.innerHTML=pending.map(c=>{
      const otherId=c.from===m.id?c.to:c.from; const other=getPlayer(otherId); const incoming=c.to===m.id;
      return `<div class="match-card" style="border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" onclick="openPlayerSheet('${esc(otherId)}')">${esc(other?other.initials:'?')}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${incoming?'Challenge from':'Challenged'} <b>${esc(displayName(otherId))}</b></div>
            <div style="font-size:12px;color:var(--fg2)">${esc(ladderLabel(c.ladder))}${c.date?' · proposed '+esc(c.date):''} · play by ${fmtShort(challengeDeadline(c))}</div>
            ${c.message?`<div style="font-size:13px;color:var(--fg2);margin-top:3px;font-style:italic">"${esc(c.message)}"</div>`:''}
          </div>
        </div>
        <div style="margin-top:8px">${c.status==='accepted'&&!isExpired(c)?'<span class="chip chip-green">Accepted</span> ':''}${c.rainedOut?`<span class="chip chip-blue">🌧️ Rained out · new play-by ${fmtShort(c.playBy)}</span> `:''}${clockLabel(c)}</div>
        ${isExpired(c)?'':incoming&&c.status==='pending'?`<div class="match-actions">
          <button class="btn btn-green btn-sm" onclick="respondChallenge('${c.id}','accepted')">Accept</button>
          <button class="btn btn-secondary btn-sm" onclick="respondChallenge('${c.id}','declined')">Decline</button>
          ${other&&other.phone?`<a class="btn btn-secondary btn-sm" href="sms:${esc(other.phone.replace(/\\D/g,''))}">Text</a>`:''}
        </div>`:`<div class="match-actions">${c.status==='accepted'?bookBtn(c.date):''}${c.status==='accepted'?`<button class="btn btn-secondary btn-sm" onclick="toggleRain('${c.id}')">🌧️ Rained out</button>`:''}${c.from===m.id?`<button class="btn btn-secondary btn-sm" onclick="cancelChallenge('${c.id}')">Withdraw</button>`:''}${other&&other.phone?`<a class="btn btn-secondary btn-sm" href="sms:${esc(other.phone.replace(/\\D/g,''))}">Text ${JR?'parent':esc(other.name.split(' ')[0])}</a>`:''}</div>${c.status==='accepted'?rainPanel(c):''}`}
      </div>`;
    }).join('');
  }
  const myMatches=state.matches.filter(x=>playedIn(x,m.id)).slice(0,5);
  $('recentList').innerHTML=myMatches.length?recentMatchesHtml(myMatches,m.id):`<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No matches yet</div><div class="empty-sub">Submit your first match score to get started.</div></div>`;
}
function renderHomeAlerts(m){
  const el=$('homeAlerts'); if(!el) return;
  let html='';
  // scores waiting for me to confirm
  const toConfirm=state.matches.filter(x=>matchState(x)==='pending'&&onOpposingSide(x,m.id));
  if(toConfirm.length){
    html+=`<div class="section-head">Confirm these scores</div><div class="card" style="border-color:var(--gold)">${toConfirm.map(x=>{
      const won=wonBy(x,m.id); const left=Math.max(0,Math.ceil((confirmDeadline(x)-Date.now())/3600000));
      return `<div class="match-card" style="border-bottom:1px solid var(--border)">
        <div style="font-weight:600;font-size:14px">${matchLine(x,m.id)}</div>
        <div style="font-size:12.5px;color:var(--fg2);margin-top:2px">${esc(ladderLabel(x.ladder))} \u00b7 ${esc(x.date)} \u00b7 entered by ${esc(displayName(x.submittedBy).split(' ')[0])}</div>
        <div style="margin-top:6px"><span class="score-pill ${won?'w':'l'}">You ${won?'won':'lost'} ${esc(x.score)}</span></div>
        <div style="font-size:12px;color:var(--fg2);margin-top:6px">Counts automatically in ${left} hour${left===1?'':'s'} if you don\u2019t respond.</div>
        <div class="match-actions"><button class="btn btn-green btn-sm" onclick="confirmMatch('${x.id}',true)">Confirm</button><button class="btn btn-secondary btn-sm" onclick="confirmMatch('${x.id}',false)">Dispute</button></div>
      </div>`;}).join('')}</div>`;
  }
  // inactivity heads-up (season only)
  if(seasonStarted()&&m.active!==false){
    const starts=decayStartsMs(m), daysTo=Math.ceil((starts-Date.now())/DAY);
    if(daysTo<=0) html+=`<div class="card" style="padding:12px 14px;margin-top:16px;border-color:var(--red)"><b style="color:var(--red)">You\u2019re sliding down the ladder.</b><div style="font-size:12.5px;color:var(--fg2);margin-top:3px;line-height:1.5">No confirmed match in over ${DECAY_GRACE} days \u2014 you lose ${DECAY_POINTS} points a week until you play. Challenge someone or accept a challenge to stop it.</div></div>`;
    else if(daysTo<=10) html+=`<div class="card" style="padding:12px 14px;margin-top:16px;border-color:var(--gold)"><b style="color:var(--gold)">Play a match by ${fmtShort(starts-DAY)}</b><div style="font-size:12.5px;color:var(--fg2);margin-top:3px;line-height:1.5">After ${DECAY_GRACE} days without a confirmed match you start losing ${DECAY_POINTS} points a week.</div></div>`;
  }
  // open window
  if(inOpenWindow(m)&&seasonStarted()) html+=`<div class="card" style="padding:12px 14px;margin-top:16px;border-color:var(--green)"><b style="color:var(--green)">Open challenges until ${fmtShort(openUntilMs(m))}</b><div style="font-size:12.5px;color:var(--fg2);margin-top:3px;line-height:1.5">You can challenge anyone in your draw to find your level fast.</div></div>`;
  el.innerHTML=html;
}
function resultPill(match,viewerId){
  const st=matchState(match);
  if(st==='disputed') return `<span class="chip chip-red">Disputed</span>`;
  if(st==='pending') return `<span class="chip chip-gold">Awaiting confirmation</span>`;
  const won=wonBy(match,viewerId); return `<span class="score-pill ${won?'w':'l'}">${won?'W':'L'} ${esc(match.score)}</span>`;
}
function recentMatchesHtml(list,viewerId){
  if(!list.length) return `<div class="empty"><div class="empty-title">No matches recorded yet</div></div>`;
  return list.map(match=>{
    if(viewerId){
      return `<div class="match-card" style="border-bottom:1px solid var(--border)"><div class="match-vs"><div class="match-player">
        <div class="match-player-name">${matchLine(match,viewerId)}</div>
        <div class="match-player-rating">${esc(ladderLabel(match.ladder))} · ${esc(match.date)}${matchState(match)!=='confirmed'?' · '+esc(match.score):''}${match.forfeit?' · forfeit':''}</div></div>
        ${resultPill(match,viewerId)}</div></div>`;
    }
    const w1=match.winner===match.p1; const [a,b,c,d]=w1?[match.p1,match.p1Partner,match.p2,match.p2Partner]:[match.p2,match.p2Partner,match.p1,match.p1Partner];
    return `<div class="match-card" style="border-bottom:1px solid var(--border)"><div class="match-player-name">${esc(displayName(a))}${b?' &amp; '+esc(displayName(b)):''} def. ${esc(displayName(c))}${d?' &amp; '+esc(displayName(d)):''}${matchState(match)!=='confirmed'?' <span class="chip '+(matchState(match)==='disputed'?'chip-red">Disputed':'chip-gold">Pending')+'</span>':''}</div>
      <div class="match-player-rating">${esc(ladderLabel(match.ladder))} · ${esc(match.date)} · ${esc(match.score)}</div></div>`;
  }).join('');
}

// ═══════════════════════════════════════════
//  LADDER
// ═══════════════════════════════════════════
let ladderFilter='';
function switchLadder(type,el){
  state.activeLadder=type;
  document.querySelectorAll('#ladderTabs .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  $('ladderSearch').value=''; ladderFilter=''; renderLadder();
}
function filterLadder(q){ ladderFilter=q.toLowerCase(); renderLadder(); }
function renderLadder(){
  const type=state.activeLadder, showUTR=$('showUTR').checked;
  const ranked=getRanked(type);
  const filtered=ladderFilter?ranked.filter(p=>p.name.toLowerCase().includes(ladderFilter)):ranked;
  const m=me(), color=ladderColor(type);
  let pairHtml='';
  if(isDoubles(type)&&!ladderFilter){
    const pairs=pairingStats(type).slice(0,5);
    pairHtml=`<div class="section-head" style="padding-top:0">Top Pairings</div>
    <div class="card" style="margin-bottom:16px">${pairs.length?pairs.map((s,i)=>{
      const [a,b]=s.ids.map(getPlayer); if(!a||!b) return '';
      return `<div class="rank-card" style="cursor:default"><div class="rank-num${i<3?' top3':''}">${i+1}</div>
        <div style="display:flex;margin-right:2px"><div class="avatar" style="width:30px;height:30px;font-size:11px;letter-spacing:-.3px">${esc(a.initials)}</div><div class="avatar" style="width:30px;height:30px;font-size:11px;letter-spacing:-.3px;margin-left:-3px;position:relative;box-shadow:0 0 0 2px var(--surface)">${esc(b.initials)}</div></div>
        <div class="rank-info"><div class="rank-name">${esc(a.name.split(' ')[0])} &amp; ${esc(b.name.split(' ')[0])}</div><div class="rank-meta">${s.played} match${s.played===1?'':'es'} together</div></div>
        <div style="text-align:right"><div class="rank-rating" style="color:${color}">${s.wins}–${s.losses}</div><div style="font-size:11px;color:var(--fg2)">${Math.round(s.pct*100)}% win</div></div></div>`;
    }).join(''):`<div class="empty" style="padding:18px"><div class="empty-sub">Pairings appear once doubles scores are submitted with partners.</div></div>`}</div>
    <div class="section-head" style="padding-top:0">Individual Rankings</div>`;
  }
  if(!filtered.length){ $('ladderList').innerHTML=pairHtml+`<div class="empty"><div class="empty-title">No players in this draw yet</div></div>`; return; }
  $('ladderList').innerHTML=pairHtml+`<div class="card">${filtered.map(p=>{
    const rank=ranked.indexOf(p)+1, isMe=m&&p.id===m.id, rating=getRating(p,type), utr=getUTR(p,type), rec=record(p);
    return `<div class="rank-card" onclick="openPlayerSheet('${esc(p.id)}')" style="${isMe?'background:rgba(45,107,228,.07);border-left:3px solid var(--accent);':''}">
      <div class="rank-num${rank<=3?' top3':''}">${rank}</div><div class="avatar">${esc(p.initials)}</div>
      <div class="rank-info"><div class="rank-name">${esc(p.name)}${isMe?' <span style="font-size:11px;color:var(--accent-hi)">(you)</span>':''}</div>
        <div class="rank-meta">${isPaper(p)?'<span title="Plays without the app" style="font-size:11px">📞</span> ':''}${isNewMember(p)&&seasonStarted()?'<span class="chip chip-green" style="padding:1px 6px;font-size:10px">NEW</span> ':''}${decayPenalty(p)?`<span class="chip chip-red" style="padding:1px 6px;font-size:10px">\u2212${decayPenalty(p)} idle</span> `:''}${lvl(p)} · ${rec.w}W ${rec.l}L${showUTR&&utr?` · <span class="utr-badge" style="vertical-align:middle"><span class="utr-label">UTR</span>${Number(utr).toFixed(2)}</span>`:''}</div></div>
      <div style="text-align:right"><div class="rank-rating" style="color:${color}">${rating}</div><div style="font-size:11px;color:var(--fg2)">pts</div></div></div>`;
  }).join('')}</div>`;
}

// ═══════════════════════════════════════════
//  PLAYER SHEET
// ═══════════════════════════════════════════
function openPlayerSheet(id){
  const p=getPlayer(id); if(!p) return;
  const m=me(), isMe=m&&id===m.id;
  $('sheetName').textContent=p.name;
  const pMatches=state.matches.filter(x=>playedIn(x,id)).slice(0,5);
  const ratingBlocks=playerLadders(p).map(t=>`<div class="card" style="padding:10px;text-align:center"><div style="font-size:10px;color:var(--fg2);text-transform:uppercase;letter-spacing:.4px">${LADDERS[t].short}</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;color:${LADDERS[t].color}">${getRating(p,t)}</div><div style="font-size:11px;color:var(--fg2)">#${rankIn(p,t)}</div></div>`);
  const utrParts=[];
  if(p.utrSingles) utrParts.push(`<span class="utr-badge"><span class="utr-label">UTR-S</span>${Number(p.utrSingles).toFixed(2)}</span>`);
  if(p.utrDoubles) utrParts.push(`<span class="utr-badge"><span class="utr-label">UTR-D</span>${Number(p.utrDoubles).toFixed(2)}</span>`);
  const digits=(p.phone||'').replace(/\D/g,'');
  const contact=!isMe?`<div class="card" style="padding:12px 14px;margin-bottom:14px">
      <div style="font-size:10px;color:var(--fg2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">${JR?'Parent contact'+(p.parentName?' · '+esc(p.parentName):''):'Contact'}</div>
      ${isPaper(p)?`<div style="font-size:13px;line-height:1.5;margin-bottom:8px;padding:8px 10px;border-radius:8px;background:rgba(232,184,75,.14)">📞 <b>${esc(p.name.split(' ')[0])} plays without the app.</b> Call or text to set up a match. Either of you can turn in a paper score card, or you can enter the score in the app.</div>`:''}
      ${p.phone?`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px"><span style="user-select:all">${esc(p.phone)}</span><span style="display:flex;gap:6px"><a class="btn btn-secondary btn-sm" href="sms:${digits}">Text</a><a class="btn btn-secondary btn-sm" href="tel:${digits}">Call</a></span></div>`:''}
      ${p.email?`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="user-select:all;font-size:13px;overflow:hidden;text-overflow:ellipsis">${esc(p.email)}</span><a class="btn btn-secondary btn-sm" href="mailto:${esc(p.email)}">Email</a></div>`:''}
      ${p.availability?`<div style="font-size:12.5px;color:var(--fg2);margin-top:8px">Usually free: ${esc(p.availability)}</div>`:''}
    </div>`:'';
  $('sheetBody').innerHTML=`
    <div style="text-align:center;margin-bottom:16px">
      <div class="avatar" style="width:60px;height:60px;font-size:24px;margin:0 auto 8px">${esc(p.initials)}</div>
      <div style="font-size:13px;color:var(--fg2)">${JR?lvl(p)+(LADDERS[p.division]?' · '+LADDERS[p.division].label:''):'NTRP '+esc(p.ntrp)+' · '+(p.membership==='full'?'Full Member':'Tennis Member')}${p.active===false?' · <span class="chip chip-red">Inactive</span>':''}</div>
      ${utrParts.length?`<div style="margin-top:8px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap">${utrParts.join('')}</div>`:''}
    </div>
    ${ratingBlocks.length?`<div style="display:grid;grid-template-columns:repeat(${Math.min(3,ratingBlocks.length)},1fr);gap:8px;margin-bottom:16px">${ratingBlocks.join('')}</div>`:''}
    ${contact}
    ${!isMe&&m&&!isPaper(p)?`<button class="btn btn-primary btn-full" style="margin-bottom:16px" onclick="closeSheet('playerSheet');goPage('Challenge',$('navChallenge'))">Challenge ${esc(p.name.split(' ')[0])}</button>`:''}
    ${!isMe&&m&&isPaper(p)&&p.phone?`<a class="btn btn-primary btn-full" style="margin-bottom:16px" href="tel:${digits}">📞 Call ${esc(p.name.split(' ')[0])} to set up a match</a>`:''}
    ${pMatches.length?`<div class="section-head" style="padding-top:0">Recent Matches</div><div class="card">${pMatches.map(match=>{const won=wonBy(match,id);
      return `<div class="match-card" style="border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;justify-content:space-between"><div><div style="font-weight:600;font-size:14px">${matchLine(match,id)}</div><div style="font-size:12px;color:var(--fg2)">${esc(ladderLabel(match.ladder))} · ${esc(match.date)}</div></div><span class="score-pill ${won?'w':'l'}">${won?'W':'L'} ${esc(match.score)}</span></div></div>`;}).join('')}</div>`:''}
    ${state.isAdmin?`<div class="divider"></div>
      <div class="section-head" style="padding-top:0">Admin</div>
      <div class="card" style="padding:14px">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Base S</label><input type="number" id="admBaseS" value="${p.baseSingles??NTRP_BASE[p.ntrp]??1200}"></div>
          <div class="form-group"><label class="form-label">Base D</label><input type="number" id="admBaseD" value="${p.baseDoubles??NTRP_BASE[p.ntrp]??1200}"></div>
          ${JR?'':`<div class="form-group"><label class="form-label">Base MX</label><input type="number" id="admBaseM" value="${p.baseMixed??NTRP_BASE[p.ntrp]??1200}"></div>`}
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">UTR S</label><input type="number" step="0.01" id="admUtrS" value="${p.utrSingles??''}"></div>
          <div class="form-group"><label class="form-label">UTR D</label><input type="number" step="0.01" id="admUtrD" value="${p.utrDoubles??''}"></div>
          <div class="form-group"><label class="form-label">Billing starts</label><input type="date" id="admBilling" value="${esc(p.billingStart||'')}"></div>
        </div>
        ${JR?jrAdminFields(p):`<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px;margin-bottom:12px">
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="admSingles" ${p.singles?'checked':''}>Singles</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="admDoubles" ${p.doubles?'checked':''}>Doubles</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="admMixed" ${p.mixed?'checked':''}>Mixed</label>
        </div>`}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="adminSavePlayer('${esc(id)}')">Save</button>
          <button class="btn ${p.active===false?'btn-green':'btn-danger'} btn-sm" onclick="adminToggleActive('${esc(id)}',${p.active===false})">${p.active===false?'Reactivate':'Mark Inactive'}</button>
          ${isPaper(p)?'':`<button class="btn btn-secondary btn-sm" onclick="openWelcome('${esc(id)}')">Send welcome</button>`}
          <button class="btn btn-secondary btn-sm" style="color:var(--red)" onclick="adminDeletePlayer('${esc(id)}')">Delete player</button>
        </div>
        <div style="font-size:11.5px;color:var(--fg2);margin-top:8px;line-height:1.4">Mark Inactive hides them from the draws but keeps their history. Delete removes the player record entirely (their past matches stay on the record under their email).</div>
      </div>`:''}`;
  $('playerSheet').classList.add('open');
}
function closeSheet(id){ $(id).classList.remove('open') }

// ═══════════════════════════════════════════
//  CHALLENGE / SCORE
// ═══════════════════════════════════════════
function initChallengePage(keep){
  const m=me(); if(!m){ $('chlLadder').innerHTML=$('scoreLadder').innerHTML=`<option value="">Admins without a player record can’t play</option>`; return; }
  const mine=playerLadders(m);
  if(!mine.length&&$('chlNote')&&JR) $('chlNote').innerHTML=`<div style="font-size:12.5px;line-height:1.5;padding:10px 12px;border-radius:8px;background:rgba(232,184,75,.14);color:var(--fg);margin-bottom:14px"><b>${esc(m.name.split(' ')[0])} isn’t in a draw yet.</b> Ask Jordan to place them.</div>`;
  else if(!mine.length&&$('chlNote')) $('chlNote').innerHTML=`<div style="font-size:12.5px;line-height:1.5;padding:10px 12px;border-radius:8px;background:rgba(155,114,240,.12);color:var(--fg);margin-bottom:14px">🥂 <b>You’re a social member</b>, so you’re not on the ranked ladder. Find games on the <b>Practice</b> tab and join the monthly mixers on <b>Events</b>. Want to be ranked? Ask Jordan to add you to a draw.</div>`;
  const opts=mine.length?mine.map(t=>`<option value="${t}">${LADDERS[t].label}</option>`).join(''):`<option value="">Not enrolled in any ladder</option>`;
  const c=$('chlLadder').value, s=$('scoreLadder').value;
  $('chlLadder').innerHTML=opts; $('scoreLadder').innerHTML=opts;
  if(keep){ if(mine.includes(c)) $('chlLadder').value=c; if(mine.includes(s)) $('scoreLadder').value=s; }
  populateOpponentsFor($('chlLadder').value,'chlOpponent');
  populateScoreOpponents();
  const bc=$('bookCard'); if(bc) bc.href=bookingHref();
  if(!keep){ const d=new Date(); d.setDate(d.getDate()+7); $('chlDate').value=d.toISOString().split('T')[0]; $('scoreDatePlayed').value=today(); }
}
function populateOpponentsFor(ladder,selectId){
  const sel=$(selectId), keep=sel.value;
  if(!ladder||!LADDERS[ladder]){ sel.innerHTML=`<option value="">—</option>`; return; }
  const ranked=getRanked(ladder), myRank=ranked.findIndex(p=>p.id===state.email);
  const m=me(); const open=m&&inOpenWindow(m);
  const eligible=open?ranked.filter(p=>p.id!==state.email):(myRank>0?ranked.filter((p,i)=>i<myRank).slice(-4):[]);
  const challengeable=eligible.filter(p=>!isPaper(p)), paperOnes=eligible.filter(isPaper);
  const note=$('chlNote');
  if(note&&selectId==='chlOpponent') note.innerHTML=open
    ?`<div style="font-size:12.5px;line-height:1.5;padding:10px 12px;border-radius:8px;background:rgba(58,170,106,.12);color:var(--fg);margin-bottom:14px">🟢 <b>Open challenges until ${fmtShort(openUntilMs(m))}.</b> ${seasonStarted()?'As a new member':'During the pre-season and the first 3 weeks of the season'} you can challenge anyone in your draw. After that it\u2019s up to 4 spots above you.</div>`
    :`<div style="font-size:12.5px;color:var(--fg2);margin-bottom:14px">You can challenge anyone up to 4 spots above you. They have ${CHALLENGE_DAYS} days to play.</div>`;
  if(note&&selectId==='chlOpponent'&&paperOnes.length) note.innerHTML+=`<div style="font-size:12.5px;line-height:1.5;margin:-6px 0 14px;color:var(--fg2)">📞 Also eligible, but they play without the app — call to set up a match: ${paperOnes.map(p=>`<b style="color:var(--fg)">${esc(p.name)}</b>${p.phone?` <a href="tel:${esc(p.phone.replace(/\D/g,''))}">${esc(p.phone)}</a>`:''}`).join(' · ')}</div>`;
  sel.innerHTML=challengeable.length?challengeable.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} (#${ranked.indexOf(p)+1})</option>`).join(''):`<option value="">${myRank===0?'You’re #1 — nobody above you!':'No eligible opponents above you'}</option>`;
  if([...sel.options].some(o=>o.value===keep)) sel.value=keep;
}
function populateScoreOpponents(){
  const ladder=$('scoreLadder').value, sel=$('scoreOpponent'), keep=sel.value;
  if(!ladder||!LADDERS[ladder]){ sel.innerHTML=`<option value="">—</option>`; return; }
  const ranked=getRanked(ladder).filter(p=>p.id!==state.email);
  sel.innerHTML=ranked.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if([...sel.options].some(o=>o.value===keep)) sel.value=keep;
  const dbl=isDoubles(ladder);
  $('scorePartnerGroup').hidden=!dbl; $('scoreOppPartnerGroup').hidden=!dbl;
  if(dbl) populateOppPartner();
}
function populateOppPartner(){
  const ladder=$('scoreLadder').value; if(!isDoubles(ladder)) return;
  const ranked=getRanked(ladder), opp=$('scoreOpponent').value;
  const pSel=$('scorePartner'), keep=pSel.value;
  pSel.innerHTML=ranked.filter(p=>p.id!==state.email&&p.id!==opp).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if([...pSel.options].some(o=>o.value===keep)) pSel.value=keep;
  const partner=pSel.value, oSel=$('scoreOppPartner'), keep2=oSel.value;
  oSel.innerHTML=ranked.filter(p=>p.id!==state.email&&p.id!==opp&&p.id!==partner).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if([...oSel.options].some(o=>o.value===keep2)) oSel.value=keep2;
}
// ── challenge clock ──
function challengeDeadline(c){ return c.playBy?c.playBy:tsMs(c.createdAt)+CHALLENGE_DAYS*DAY; }
const RAIN_DAYS = 7;   // a rain-out adds this many days to the challenge clock (once per challenge)
function isOpenChallenge(c){ return c.status==='pending'||c.status==='accepted'; }
function isExpired(c){ return isOpenChallenge(c)&&Date.now()>challengeDeadline(c); }
function clockLabel(c){
  if(isExpired(c)) return `<span class="chip chip-red">Expired \u2014 Jordan will decide</span>`;
  const left=challengeDeadline(c)-Date.now(); const d=Math.floor(left/DAY), h=Math.floor((left%DAY)/3600000);
  const txt=d>=1?`${d} day${d===1?'':'s'} left to play`:`${h} hour${h===1?'':'s'} left to play`;
  return `<span class="chip ${d<2?'chip-red':'chip-gold'}">${txt}</span>`;
}
async function sendChallenge(){
  const to=$('chlOpponent').value, ladder=$('chlLadder').value;
  if(!to){ toast('No eligible opponents above you'); return; }
  if(state.challenges.some(c=>isOpenChallenge(c)&&!isExpired(c)&&c.ladder===ladder&&((c.from===state.email&&c.to===to)||(c.from===to&&c.to===state.email)))){ toast('You already have an open challenge with them'); return; }
  try{
    await db.collection(COL('challenges')).add({from:state.email,to,ladder,date:$('chlDate').value,message:$('chlMessage').value.trim().slice(0,300),status:'pending',createdAt:FieldValue.serverTimestamp()});
    $('chlMessage').value=''; toast(`Challenge sent! Play by ${fmtShort(Date.now()+CHALLENGE_DAYS*DAY)} 🎾`);
  }catch(e){ toast('Could not send: '+e.message); }
}
async function confirmMatch(id,ok){
  try{
    await db.collection(COL('matches')).doc(id).update({status:ok?'confirmed':'disputed',confirmedBy:state.email,confirmedAt:FieldValue.serverTimestamp()});
    toast(ok?'Confirmed \u2014 rankings updated ✓':'Disputed \u2014 Jordan will sort it out');
  }catch(e){ toast('Could not update: '+e.message); }
}
async function respondChallenge(cid,status){
  try{ await db.collection(COL('challenges')).doc(cid).update({status,respondedAt:FieldValue.serverTimestamp()}); toast(status==='accepted'?'Challenge accepted! Set up a time by text.':'Challenge declined.'); }
  catch(e){ toast('Could not update: '+e.message); }
}
// ── rain-outs ──
function rainNewDeadline(c){ return Math.max(challengeDeadline(c),Date.now())+RAIN_DAYS*DAY; }
function rainPanel(c){
  const again=!!c.rainedOut;
  return `<div class="rain-panel" id="rain-${c.id}" hidden>
    <div style="font-weight:600;font-size:13.5px;margin-bottom:6px">🌧️ Rained out? Pick one:</div>
    ${again?`<div style="font-size:12.5px;color:var(--fg2);margin-bottom:8px">This match has already been rescheduled once. Play by ${fmtShort(c.playBy)}, or cancel it below.</div>`
    :`<label class="form-label" for="rainDate-${c.id}" style="margin-top:0">New date (optional)</label>
      <input type="date" id="rainDate-${c.id}" min="${today()}" value="">
      <div class="match-actions" style="margin-top:8px"><button class="btn btn-primary btn-sm" onclick="rainReschedule('${c.id}')">Reschedule · play by ${fmtShort(rainNewDeadline(c))}</button></div>`}
    <div class="match-actions" style="margin-top:6px"><button class="btn btn-secondary btn-sm" id="rainCancel-${c.id}" onclick="rainCancel('${c.id}')">Cancel match · no penalty</button></div>
    <div style="font-size:11.5px;color:var(--fg2);margin-top:8px;line-height:1.45">Rescheduling adds ${RAIN_DAYS} days to the clock (once per challenge). Cancelling closes the challenge with no effect on anyone's ranking; either of you can send a new one any time.</div>
  </div>`;
}
function toggleRain(cid){ const el=$('rain-'+cid); if(el) el.hidden=!el.hidden; }
async function rainReschedule(cid){
  const c=state.challenges.find(x=>x.id===cid); if(!c||c.rainedOut) return;
  const d=($('rainDate-'+cid)||{}).value||'';
  const upd={rainedOut:true,rainBy:state.email,rainAt:FieldValue.serverTimestamp(),playBy:rainNewDeadline(c)};
  if(d) upd.date=d;
  try{ await db.collection(COL('challenges')).doc(cid).update(upd); toast(`Rescheduled 🌧️ New play-by date: ${fmtShort(upd.playBy)}`); }
  catch(e){ toast('Could not reschedule: '+e.message); }
}
let pendingRainCancel=null;
async function rainCancel(cid){
  if(pendingRainCancel!==cid){ pendingRainCancel=cid; const b=$('rainCancel-'+cid); if(b) b.textContent='Tap again to cancel the match'; setTimeout(()=>{ if(pendingRainCancel===cid){ pendingRainCancel=null; const b2=$('rainCancel-'+cid); if(b2) b2.textContent='Cancel match · no penalty'; } },4000); return; }
  pendingRainCancel=null;
  try{ await db.collection(COL('challenges')).doc(cid).update({status:'rainout',rainBy:state.email,rainAt:FieldValue.serverTimestamp()}); toast('Match cancelled for rain. No penalty.'); }
  catch(e){ toast('Could not cancel: '+e.message); }
}
async function cancelChallenge(cid){
  try{ await db.collection(COL('challenges')).doc(cid).delete(); toast('Challenge withdrawn'); }catch(e){ toast('Could not withdraw: '+e.message); }
}
async function submitScore(){
  const opp=$('scoreOpponent').value, ladder=$('scoreLadder').value, result=$('scoreResult').value, score=$('scoreInput').value.trim(), date=$('scoreDatePlayed').value;
  if(!ladder||!LADDERS[ladder]){ toast('Select a ladder'); return; }
  if(!opp){ toast('Select an opponent'); return; }
  if(!score){ toast('Please enter the match score'); return; }
  if(!date){ toast('Please enter the date played'); return; }
  const dbl=isDoubles(ladder);
  const p1Partner=dbl?$('scorePartner').value:null, p2Partner=dbl?$('scoreOppPartner').value:null;
  if(dbl){ if(!p1Partner||!p2Partner){ toast('Select both partners'); return; } if(new Set([state.email,p1Partner,opp,p2Partner]).size<4){ toast('Each player can only appear once'); return; } }
  const winner=result==='win'?state.email:opp;
  try{
    await db.collection(COL('matches')).add({p1:state.email,p1Partner,p2:opp,p2Partner,ladder,score:score.slice(0,40),winner,date,submittedBy:state.email,status:'pending',createdAt:FieldValue.serverTimestamp()});
    // auto-close any pending challenge between these two in this draw
    state.challenges.filter(c=>isOpenChallenge(c)&&c.ladder===ladder&&((c.from===state.email&&c.to===opp)||(c.from===opp&&c.to===state.email)))
      .forEach(c=>db.collection(COL('challenges')).doc(c.id).update({status:'played'}).catch(()=>{}));
    $('scoreInput').value=''; toast(`Score sent \u2014 it counts once ${displayName(opp).split(' ')[0]} confirms (or automatically in ${CONFIRM_HOURS} hours)`);
  }catch(e){ toast('Could not submit: '+e.message); }
}

// ═══════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════
function renderProfile(){
  const m=me();
  $('profEmail').textContent=state.authEmail||state.email;
  if(!m){ $('profileAvatar').textContent='A'; $('profileName').textContent='Ladder Admin'; $('profileMember').textContent=state.email; $('profileChips').innerHTML=''; $('profRanks').innerHTML=''; $('profUTRRow').innerHTML=''; ['profW','profL','profM','profPct'].forEach(id=>$(id).textContent='—'); $('historyList').innerHTML=`<div class="empty"><div class="empty-title">No player record</div><div class="empty-sub">Add yourself from the Admin tab to compete.</div></div>`; return; }
  const mine=playerLadders(m), rec=record(m);
  $('profileAvatar').textContent=m.initials; $('profileName').textContent=m.name;
  $('profileMember').textContent=JR?[LADDERS[m.division]?LADDERS[m.division].label:'Junior',m.ntrp?m.ntrp+' ball':''].filter(Boolean).join(' · ')+' — Gold River SC':(m.membership==='full'?'Full Member':'Tennis Member')+' — Gold River SC';
  $('profileChips').innerHTML=mine.length?mine.map(t=>`<span class="chip ${LADDERS[t].chip}">${LADDERS[t].short} #${rankIn(m,t)}</span>`).join(''):(m.social?'<span class="chip chip-purple">🥂 Social member</span>':'');
  const rankItems=mine.map(t=>`<div style="text-align:center"><div style="font-size:10px;color:var(--fg2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">${LADDERS[t].short}</div>
    <div style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;color:${LADDERS[t].color}">#${rankIn(m,t)}</div><div style="font-size:12px;color:var(--fg2)">${getRating(m,t)} pts</div></div>`);
  const g=$('profRanks'); g.style.gridTemplateColumns=`repeat(${Math.min(3,Math.max(1,rankItems.length))},1fr)`;
  g.innerHTML=rankItems.length?rankItems.join(''):`<div style="font-size:13px;color:var(--fg2);line-height:1.5">${m.social?'You’re a <b style="color:var(--fg)">social member</b> — not ranked. Use the Practice tab to find games and the Events tab for socials and mixers. Want to join a ladder draw? Ask Jordan; it’s free to switch.':'You’re not in any ladder draw yet. Ask Jordan to add you.'}</div>`;
  const utrParts=[];
  if(m.utrSingles) utrParts.push(`<div><div style="font-size:10px;color:var(--purple);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">UTR Singles</div><span class="utr-badge" style="font-size:14px;padding:4px 10px"><span class="utr-label">UTR</span>${Number(m.utrSingles).toFixed(2)}</span></div>`);
  if(m.utrDoubles) utrParts.push(`<div><div style="font-size:10px;color:var(--purple);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">UTR Doubles</div><span class="utr-badge" style="font-size:14px;padding:4px 10px"><span class="utr-label">UTR</span>${Number(m.utrDoubles).toFixed(2)}</span></div>`);
  $('profUTRRow').innerHTML=utrParts.length?utrParts.join(''):`<span style="font-size:12px;color:var(--fg2);font-style:italic">No UTR ratings on file — ask Jordan to add yours</span>`;
  $('profW').textContent=rec.w; $('profL').textContent=rec.l; $('profM').textContent=rec.w+rec.l; $('profPct').textContent=Math.round(rec.w/((rec.w+rec.l)||1)*100)+'%';
  const hist=state.matches.filter(x=>playedIn(x,m.id));
  $('historyList').innerHTML=hist.length?recentMatchesHtml(hist,m.id):`<div class="empty"><div class="empty-title">No match history yet</div></div>`;
  if(document.activeElement!==$('profPhone')) $('profPhone').value=m.phone||'';
  if(document.activeElement!==$('profAvail')) $('profAvail').value=m.availability||'';
}
async function saveContact(){
  try{ await db.collection(COL('players')).doc(state.email).update({phone:$('profPhone').value.trim().slice(0,30),availability:$('profAvail').value.trim().slice(0,120)}); toast('Saved'); }
  catch(e){ toast('Could not save: '+e.message); }
}

// ═══════════════════════════════════════════
//  PRACTICE BOARD
// ═══════════════════════════════════════════
const HIT_FORMATS={hit:'Hitting / rally',drill:'Drills & points',singles:'Practice set · singles',doubles:'Practice set · doubles'};
let hitTab='match';
function levelsMatch(viewer,hit){ const by=getPlayer(hit.by); if(!by) return false; return Math.abs(parseFloat(viewer.ntrp)-parseFloat(by.ntrp))<=hit.range+0.001; }
function switchHit(tab,el){ hitTab=tab; document.querySelectorAll('#hitTabs .tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); renderPractice(); }
function initDayPickers(){ document.querySelectorAll('.day-picker span').forEach(sp=>{ if(!sp.dataset.bound){ sp.dataset.bound='1'; sp.addEventListener('click',()=>sp.classList.toggle('on')); } }); }
function pickedValues(id){ return [...document.querySelectorAll('#'+id+' span.on')].map(s=>s.dataset.d) }
function renderPractice(){
  initDayPickers();
  const m=me();
  let list=[...state.hits].filter(h=>!h.closed);
  if(hitTab==='match') list=m?list.filter(h=>h.by!==m.id&&levelsMatch(m,h)):[];
  if(hitTab==='mine')  list=list.filter(h=>h.by===state.email);
  list.sort((a,b)=>(b.posted||'').localeCompare(a.posted||''));
  const el=$('hitList');
  if(!list.length){
    const msg=hitTab==='mine'?'You haven’t posted a request yet.':hitTab==='match'?'No open requests near your level right now — post one!':'No open requests.';
    el.innerHTML=`<div class="empty"><div class="empty-icon">🎾</div><div class="empty-title">${msg}</div></div>`; return;
  }
  el.innerHTML=`<div class="card">${list.map(h=>{
    const p=getPlayer(h.by); if(!p) return ''; const mine=h.by===state.email; const responses=h.responses||[]; const replied=responses.includes(state.email);
    return `<div class="match-card" style="border-bottom:1px solid var(--border)"><div style="display:flex;align-items:flex-start;gap:10px">
      <div class="avatar" onclick="openPlayerSheet('${esc(p.id)}')">${esc(p.initials)}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><div style="font-weight:600">${esc(p.name)}${mine?' <span style="font-size:11px;color:var(--accent-hi)">(you)</span>':''}</div><div style="font-size:11px;color:var(--fg2);white-space:nowrap">${esc(h.posted)}</div></div>
        <div style="font-size:12px;color:var(--fg2);margin-bottom:6px">NTRP ${esc(p.ntrp)} · ${HIT_FORMATS[h.format]||esc(h.format)} · ${h.range>=99?'any level':'± '+Number(h.range).toFixed(1)}</div>
        <div>${(h.days||[]).map(d=>`<span class="hit-tag">${esc(d)}</span>`).join('')}${(h.times||[]).map(t=>`<span class="hit-tag" style="color:var(--accent-hi);background:rgba(45,107,228,.12)">${esc(t)}</span>`).join('')}</div>
        ${h.note?`<div style="font-size:13px;margin-top:6px">${esc(h.note)}</div>`:''}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;gap:8px;flex-wrap:wrap">
          <div style="font-size:12px;color:var(--fg2)">${responses.length?`${responses.length} interested${mine?': '+responses.map(id=>esc(displayName(id).split(' ')[0])).join(', '):''}`:'No replies yet'}</div>
          ${mine?`<button class="btn btn-secondary btn-sm" onclick="closeHit('${h.id}')">Close</button>`
               :`<span style="display:flex;gap:6px"><button class="btn ${replied?'btn-secondary':'btn-primary'} btn-sm" onclick="toggleInterest('${h.id}')">${replied?'Interested ✓':"I'm in"}</button>${p.phone?`<a class="btn btn-secondary btn-sm" href="sms:${esc(p.phone.replace(/\\D/g,''))}">Text</a>`:''}</span>`}
        </div></div></div></div>`;
  }).join('')}</div>`;
}
async function postHit(){
  if(!me()){ toast('Add yourself as a player first'); return; }
  const days=pickedValues('hitDays'), times=pickedValues('hitTimes');
  if(!days.length){ toast('Pick at least one day'); return; } if(!times.length){ toast('Pick at least one time'); return; }
  try{
    await db.collection(COL('hits')).add({by:state.email,format:$('hitFormat').value,range:parseFloat($('hitRange').value),days,times,note:$('hitNote').value.trim().slice(0,200),posted:today(),responses:[],closed:false,createdAt:FieldValue.serverTimestamp()});
    document.querySelectorAll('.day-picker span.on').forEach(s=>s.classList.remove('on')); $('hitNote').value='';
    toast('Posted — members near your level will see it 🎾');
    switchHit('mine',document.querySelectorAll('#hitTabs .tab')[2]);
  }catch(e){ toast('Could not post: '+e.message); }
}
async function toggleInterest(id){
  const h=state.hits.find(x=>x.id===id); if(!h) return;
  const replied=(h.responses||[]).includes(state.email);
  try{ await db.collection(COL('hits')).doc(id).update({responses:replied?FieldValue.arrayRemove(state.email):FieldValue.arrayUnion(state.email)}); toast(replied?'Removed your interest':`${displayName(h.by).split(' ')[0]} will see you’re in 🎾`); }
  catch(e){ toast('Could not update: '+e.message); }
}
async function closeHit(id){ try{ await db.collection(COL('hits')).doc(id).update({closed:true}); toast('Request closed'); }catch(e){ toast('Could not close: '+e.message); } }

// ═══════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════
let adminTab='signups';
function switchAdmin(tab,el){ adminTab=tab; document.querySelectorAll('#adminTabs .tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); renderAdmin(); }
function renderAdmin(){
  if(!state.isAdmin) return;
  ['signups','players','matches','add'].forEach(t=>$('admin'+t[0].toUpperCase()+t.slice(1)).hidden=adminTab!==t);
  if(adminTab==='signups') renderSignups();
  if(adminTab==='players') renderAdminPlayers($('adminSearch').value.toLowerCase());
  if(adminTab==='matches') renderAdminMatches();
  renderSignupBadge();
  renderMatchBadge();
}
function renderSignupBadge(){ const n=state.signups.filter(s=>s.status==='pending').length; $('signupCount').textContent=n; $('signupCount').hidden=!n; }
function renderSignups(){
  if(JR) return jrRenderSignups();
  const list=state.signups.filter(s=>s.status==='pending').sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  $('signupList').innerHTML=list.length?list.map(s=>{
    const draws=(s.draws||[]); const exists=!!getPlayer(norm(s.email));
    return `<div class="match-card" style="border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><div style="font-weight:600;font-size:15px">${esc(s.name)}</div><div style="font-size:11px;color:var(--fg2)">${s.createdAt?new Date(s.createdAt.seconds*1000).toLocaleDateString():''}</div></div>
      <div style="font-size:13px;color:var(--fg2);margin-top:2px;line-height:1.5">${esc(s.email)} · ${esc(s.phone||'')}<br>USTA ${esc(s.ntrp)}${s.utr?' · UTR '+esc(s.utr):''} · ${esc(s.placement||'')}<br>Draws: ${draws.map(esc).join(', ')||'—'}${s.avail?'<br>Available: '+esc(s.avail):''}</div>
      ${exists?`<div style="font-size:12px;color:var(--gold);margin-top:6px">Already on the ladder — approving will update their record.</div>`:''}
      <div class="match-actions"><button class="btn btn-green btn-sm" onclick="approveSignup('${s.id}')">Approve &amp; add</button><button class="btn btn-secondary btn-sm" onclick="declineSignup('${s.id}')">Decline</button>${s.phone?`<a class="btn btn-secondary btn-sm" href="sms:${esc(s.phone.replace(/\\D/g,''))}">Text</a>`:''}</div>
    </div>`;
  }).join(''):`<div class="empty"><div class="empty-icon">📬</div><div class="empty-title">No pending sign-ups</div><div class="empty-sub">New submissions from the sign-up page appear here.</div></div>`;
}
async function approveSignup(id){
  const s=state.signups.find(x=>x.id===id); if(!s) return;
  if(JR) return jrApproveSignup(s);
  const email=norm(s.email); const draws=s.draws||[];
  const ntrp=String(s.ntrp||'3.5').replace('+','');
  const existing=getPlayer(email)||{};
  const doc={
    name:s.name.trim(), initials:initialsOf(s.name), email, phone:s.phone||'', ntrp:NTRP_BASE[ntrp]?ntrp:'3.5',
    gender:(s.placement||'').startsWith('Women')?'F':'M', membership:existing.membership||'full',
    singles:draws.includes('Singles'), doubles:draws.includes('Doubles'), mixed:draws.includes('Mixed Doubles'),
    social:!draws.some(d=>['Singles','Doubles','Mixed Doubles'].includes(d)),
    utrSingles:s.utr?Number(s.utr):(existing.utrSingles??null), utrDoubles:existing.utrDoubles??null,
    availability:s.avail||existing.availability||'', active:true, billingStart:existing.billingStart||'2027-01-01',
    baseSingles:existing.baseSingles??NTRP_BASE[ntrp]??1200, baseDoubles:existing.baseDoubles??NTRP_BASE[ntrp]??1200, baseMixed:existing.baseMixed??NTRP_BASE[ntrp]??1200,
    createdAt:existing.createdAt||FieldValue.serverTimestamp(), approvedBy:state.email
  };
  try{
    await db.collection(COL('players')).doc(email).set(doc,{merge:true});
    await db.collection(COL('signups')).doc(id).update({status:'approved',approvedAt:FieldValue.serverTimestamp()});
    toast(`${doc.name} added to the ladder ✓`);
    setTimeout(()=>openWelcome(email),350);
  }catch(e){ toast('Could not approve: '+e.message); }
}
async function declineSignup(id){ try{ await db.collection(COL('signups')).doc(id).update({status:'declined'}); toast('Declined'); }catch(e){ toast('Could not update: '+e.message); } }
function filterAdminPlayers(q){ renderAdminPlayers(q.toLowerCase()) }
function renderAdminPlayers(filter=''){
  const players=[...state.players].filter(p=>!filter||p.name.toLowerCase().includes(filter)||(p.email||'').includes(filter)).sort((a,b)=>a.name.localeCompare(b.name));
  $('adminPlayerList').innerHTML=players.length?players.map(p=>{
    const rec=record(p);
    const draws=playerLadders(p).map(t=>`<span class="pstat" style="color:${LADDERS[t].color}">${LADDERS[t].short} <b>#${rankIn(p,t)}</b> \u00b7 ${getRating(p,t)}</span>`).join('');
    const utr=[p.utrSingles!=null?`UTR-S <b>${Number(p.utrSingles).toFixed(2)}</b>`:'',p.utrDoubles!=null?`UTR-D <b>${Number(p.utrDoubles).toFixed(2)}</b>`:''].filter(Boolean).map(x=>`<span class="pstat" style="color:var(--purple)">${x}</span>`).join('');
    return `<div class="pcard" onclick="openPlayerSheet('${esc(p.id)}')">
      <div class="pcard-top">
        <div class="avatar" style="width:34px;height:34px;font-size:13px">${esc(p.initials)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
          <div style="font-size:12px;color:var(--fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${JR?lvl(p)+(p.birthYear?' \u00b7 born '+esc(p.birthYear):''):'NTRP '+esc(p.ntrp)+' \u00b7 '+(p.gender==='F'?"Women's":"Men's")} \u00b7 ${isPaper(p)?'📞 paper player'+(p.phone?' \u00b7 '+esc(p.phone):''):esc(p.email)}</div>
        </div>
        <span class="chip ${p.active!==false?'chip-green':'chip-red'}">${p.active!==false?'Active':'Inactive'}</span>
        <span style="color:var(--fg2);font-size:20px;line-height:1">\u203a</span>
      </div>
      <div class="pcard-stats">${draws||(p.social?'<span class="pstat" style="color:var(--purple)">🥂 Social member</span>':'<span class="pstat">No draws</span>')}${utr}<span class="pstat">${rec.w}W\u2013${rec.l}L</span><span class="pstat">Billing <b>${esc(p.billingStart||'\u2014')}</b></span></div>
    </div>`;
  }).join(''):`<div class="empty"><div class="empty-title">No players yet</div><div class="empty-sub">Approve a sign-up or add one from the Add tab.</div></div>`;
}
function adminAlerts(){ return {disputed:state.matches.filter(m=>matchState(m)==='disputed'), expired:state.challenges.filter(isExpired)}; }
function renderMatchBadge(){ const a=adminAlerts(), n=a.disputed.length+a.expired.length; const el=$('matchAlertCount'); if(el){ el.textContent=n; el.hidden=!n; } }
function renderAdminMatches(){
  const a=adminAlerts();
  let att='';
  if(a.disputed.length||a.expired.length){
    att=`<div class="section-head" style="padding-top:0;color:var(--red)">Needs your attention</div><div class="card" style="border-color:var(--red);margin-bottom:16px">`+
      a.disputed.map(m=>`<div class="match-card" style="border-bottom:1px solid var(--border)">
        <div><span class="chip chip-red">Disputed score</span></div>
        <div style="font-weight:600;font-size:14px;margin-top:6px">${esc(displayName(m.p1))}${m.p1Partner?' &amp; '+esc(displayName(m.p1Partner)):''} vs ${esc(displayName(m.p2))}${m.p2Partner?' &amp; '+esc(displayName(m.p2Partner)):''}</div>
        <div style="font-size:12.5px;color:var(--fg2);margin-top:2px;line-height:1.5">${esc(ladderLabel(m.ladder))} \u00b7 ${esc(m.date)} \u00b7 ${esc(m.score)}<br>Entered by ${esc(displayName(m.submittedBy))} (winner: ${esc(displayName(m.winner))}) \u00b7 disputed by ${esc(displayName(m.confirmedBy))}</div>
        <div class="match-actions"><button class="btn btn-green btn-sm" onclick="adminResolveMatch('${m.id}')">Count it</button><button class="btn btn-danger btn-sm" onclick="deleteMatch('${m.id}')">Delete</button></div></div>`).join('')+
      a.expired.map(c=>`<div class="match-card" style="border-bottom:1px solid var(--border)">
        <div><span class="chip chip-gold">Challenge expired ${fmtShort(challengeDeadline(c))}</span></div>
        <div style="font-weight:600;font-size:14px;margin-top:6px">${esc(displayName(c.from))} challenged ${esc(displayName(c.to))}</div>
        <div style="font-size:12.5px;color:var(--fg2);margin-top:2px">${esc(ladderLabel(c.ladder))} \u00b7 status: ${esc(c.status)}</div>
        <div class="match-actions"><button class="btn btn-primary btn-sm" onclick="awardForfeit('${c.id}')">Forfeit win to ${esc(displayName(c.from).split(' ')[0])}</button><button class="btn btn-secondary btn-sm" onclick="voidChallenge('${c.id}')">Void</button></div></div>`).join('')+
      `</div>`;
  }
  const since=Date.now()-30*DAY;
  const rains=state.challenges.filter(c=>(c.rainedOut||c.status==='rainout')&&tsMs(c.rainAt||c.createdAt)>=since).sort((a,b)=>tsMs(b.rainAt)-tsMs(a.rainAt));
  if(rains.length){
    att+=`<div class="section-head" style="padding-top:0">🌧️ Rain-outs, last 30 days <span style="font-weight:400;text-transform:none;letter-spacing:0">(for your info, nothing to do)</span></div><div class="card" style="margin-bottom:16px">`+
      rains.map(c=>`<div class="match-card" style="border-bottom:1px solid var(--border)">
        <div style="font-weight:600;font-size:14px">${esc(displayName(c.from))} vs ${esc(displayName(c.to))}</div>
        <div style="font-size:12.5px;color:var(--fg2);margin-top:2px">${esc(ladderLabel(c.ladder))} \u00b7 ${c.status==='rainout'?'<span class="chip chip-gold">Cancelled</span>':'<span class="chip chip-blue">Rescheduled \u00b7 play by '+fmtShort(c.playBy)+'</span>'} \u00b7 by ${esc(displayName(c.rainBy))}${c.rainAt?' on '+fmtShort(tsMs(c.rainAt)):''}</div></div>`).join('')+`</div>`;
  }
  if(att) att+=`<div class="section-head" style="padding-top:0">All matches</div>`;
  renderMatchBadge();
  $('adminMatchList').innerHTML=att+'<div class="card">'+(state.matches.length?state.matches.map(m=>{const st=matchState(m);return `<div class="match-card" style="border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="min-width:0"><div style="font-weight:600;font-size:14px">${esc(displayName(m.p1))}${m.p1Partner?' &amp; '+esc(displayName(m.p1Partner)):''} vs ${esc(displayName(m.p2))}${m.p2Partner?' &amp; '+esc(displayName(m.p2Partner)):''}</div>
      <div style="font-size:12px;color:var(--fg2)">${esc(ladderLabel(m.ladder))} · ${esc(m.date)} · W: ${esc(displayName(m.winner))} · by ${esc(displayName(m.submittedBy))}</div><div style="font-size:13px;margin-top:2px">${esc(m.score)} ${st==='confirmed'?'':'<span class="chip '+(st==='disputed'?'chip-red">Disputed':'chip-gold">Pending')+'</span>'}</div></div>
      <button class="btn btn-danger btn-sm" onclick="deleteMatch('${m.id}')">Del</button></div></div>`;}).join('')
    :`<div class="empty"><div class="empty-title">No matches recorded</div></div>`)+'</div>';
}
async function adminResolveMatch(id){ try{ await db.collection(COL('matches')).doc(id).update({status:'confirmed',resolvedBy:state.email}); toast('Counted \u2014 rankings updated'); }catch(e){ toast('Could not update: '+e.message); } }
async function awardForfeit(cid){
  const c=state.challenges.find(x=>x.id===cid); if(!c) return;
  try{
    await db.collection(COL('matches')).add({p1:c.from,p1Partner:null,p2:c.to,p2Partner:null,ladder:c.ladder,score:'Forfeit',winner:c.from,date:today(),submittedBy:state.email,status:'confirmed',forfeit:true,createdAt:FieldValue.serverTimestamp()});
    await db.collection(COL('challenges')).doc(cid).update({status:'forfeited'});
    toast(`Forfeit win recorded for ${displayName(c.from).split(' ')[0]}`);
  }catch(e){ toast('Could not record: '+e.message); }
}
async function voidChallenge(cid){ try{ await db.collection(COL('challenges')).doc(cid).update({status:'void'}); toast('Challenge voided'); }catch(e){ toast('Could not update: '+e.message); } }
let pendingDelete=null;
async function deleteMatch(id){
  if(pendingDelete!==id){ pendingDelete=id; toast('Tap Del again to confirm'); setTimeout(()=>{ if(pendingDelete===id) pendingDelete=null; },4000); return; }
  pendingDelete=null;
  try{ await db.collection(COL('matches')).doc(id).delete(); toast('Match deleted — ratings recalculated'); }catch(e){ toast('Could not delete: '+e.message); }
}
async function addPlayer(){
  if(JR) return jrAddPlayer();
  const name=$('addName').value.trim(), paper=$('addPaper').checked;
  let email=norm($('addEmail').value);
  if(!name){ toast('Please enter a name'); return; }
  if(paper){
    if(!$('addPhone').value.trim()){ toast('Add a phone number so members can call them'); return; }
    if(email&&!/^\S+@\S+\.\S+$/.test(email)){ toast('That email doesn’t look right (or leave it blank)'); return; }
  } else if(!/^\S+@\S+\.\S+$/.test(email)){ toast('Please enter a valid email — it’s their login'); return; }
  // paper players get a placeholder ID instead of an email login
  const id = paper ? 'paper-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+Math.random().toString(36).slice(2,6) : email;
  const ntrp=$('addNTRP').value, base=NTRP_BASE[ntrp]||1200;
  const singles=$('addSingles').checked, doubles=$('addDoubles').checked, mixed=$('addMixed').checked;
  const social=$('addSocial').checked&&!singles&&!doubles&&!mixed;
  if(!singles&&!doubles&&!mixed&&!social){ toast('Pick at least one draw, or tick Social member'); return; }
  if(!paper&&getPlayer(email)){ toast('That email is already on the ladder'); return; }
  try{
    await db.collection(COL('players')).doc(id).set({
      name,initials:initialsOf(name),email:paper?(email||''):email,paper,phone:$('addPhone').value.trim(),ntrp,gender:$('addGender').value,membership:$('addMembership').value,
      utrSingles:parseFloat($('addUTRS').value)||null,utrDoubles:parseFloat($('addUTRD').value)||null,
      singles,doubles,mixed,social,active:true,baseSingles:base,baseDoubles:base,baseMixed:base,billingStart:'2027-01-01',availability:'',createdAt:FieldValue.serverTimestamp(),approvedBy:state.email
    });
    ['addName','addEmail','addPhone','addUTRS','addUTRD'].forEach(x=>$(x).value='');
    $('addPaper').checked=false; togglePaperForm();
    if(paper){ toast(`${name} added as a paper player ✓`); }
    else { toast(`${name} added to the ladder ✓`); setTimeout(()=>openWelcome(email),350); }
  }catch(e){ toast('Could not add: '+e.message); }
}
function togglePaperForm(){
  const on=$('addPaper').checked;
  $('addEmailLabel').textContent=on?'Email (optional)':'Email (their login)';
  $('addPaperNote').hidden=!on;
}
async function adminSavePlayer(id){
  const num=v=>{ const n=parseFloat(v); return isNaN(n)?null:n; };
  if(JR) return jrSavePlayer(id,num);
  try{
    await db.collection(COL('players')).doc(id).update({
      baseSingles:num($('admBaseS').value)??1200, baseDoubles:num($('admBaseD').value)??1200, baseMixed:num($('admBaseM').value)??1200,
      utrSingles:num($('admUtrS').value), utrDoubles:num($('admUtrD').value), billingStart:$('admBilling').value||'',
      singles:$('admSingles').checked, doubles:$('admDoubles').checked, mixed:$('admMixed').checked,
      social:!$('admSingles').checked&&!$('admDoubles').checked&&!$('admMixed').checked
    });
    toast('Saved'); closeSheet('playerSheet');
  }catch(e){ toast('Could not save: '+e.message); }
}
// ── welcome message (sent from the admin's own phone; no email service needed) ──
const APP_URL='https://jpboyls-crypto.github.io/gold-river-ladder/'+(JR?'junior/':'');
// Setup steps shared by the text and the email.
function setupSteps(p){
  return `1) Open this link on your phone — in Safari on iPhone, Chrome on Android:\n${APP_URL}\n\n`+
    `2) Add it to your home screen first.\n   iPhone: tap the Share button (square with the up arrow) → Add to Home Screen → Add.\n   Android: tap the ⋮ menu → Add to Home screen (or Install app).\n\n`+
    `3) Open the new ${JR?'GR Junior Ladder':'GR Ladder'} icon, enter ${p.email} and tap "Email me a sign-in link."\n\n`+
    `4) In that email, don't tap the link — press and hold it, choose Copy Link, then go back to the ladder app, paste it in the box and tap Sign in. (Check spam the first time.)\n\n`+
    `That's it — you'll stay signed in after that.`;
}
function seasonLabel(){ return new Date(SEASON_START+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); }
// Short version for a text message.
function welcomeText(p){
  if(JR) return jrWelcomeText(p);
  const first=(p.name||'').split(' ')[0]||'there';
  const draws=playerLadders(p).map(t=>LADDERS[t].label).join(', ');
  return `Hi ${first}, you're in! Welcome to the Gold River Tennis Ladder${draws?' ('+draws+')':''}.\n\n`+
    `Getting set up takes 2 minutes:\n\n`+setupSteps(p)+`\n\n`+
    `Once you're in, tap the ? at the top of the app for the full rules and FAQ. Play is free until the season starts ${seasonLabel()}.\n\n— Jordan`;
}
// Full version for email: setup + a tour of everything the app does.
function welcomeEmail(p){
  if(JR) return jrWelcomeEmail(p);
  const first=(p.name||'').split(' ')[0]||'there';
  const draws=playerLadders(p).map(t=>LADDERS[t].label);
  const pts=getRating(p,playerLadders(p)[0]||'ms');
  const H=t=>`\n\n━━ ${t.toUpperCase()} ━━\n`;
  const tourneys=state.events.filter(e=>e.type==='tournament'&&(e.date||'')>=today()).sort((a,b)=>a.date.localeCompare(b.date));
  return `Hi ${first},\n\n`+
  `You're officially on the Gold River Tennis Ladder — welcome! `+
  `${draws.length?`You're entered in ${draws.length===1?'the '+draws[0]+' draw':draws.slice(0,-1).join(', ')+' and '+draws.slice(-1)+' draws'}. `:(p.social?`You've joined as a social member, so you won't be ranked: the app is your way to find games, sign up for socials and the monthly mixers, and get member pricing. You can join a ranked draw any time. `:'')}`+
  `Everything runs through the ladder app on your phone: challenges, scores, rankings, finding hitting partners, and events. Here's how to get set up and what you can do with it.`+
  H('Get set up (2 minutes)')+setupSteps(p)+
  H('How the ladder works')+
  `• Everyone has points in each draw they play, and rankings are simply who has the most. You start at ${pts} points, based on your level.\n`+
  `• Win a match: +${WIN} points. Lose: ${LOSS} points. In doubles, both partners get the same.\n`+
  `• There are five draws: Men's and Women's Singles, Men's and Women's Doubles, and Mixed Doubles. Doubles is ranked individually, so you can play with different partners.`+
  H("What's in the app")+
  `HOME — Your rank in each draw, your record, open challenges with how many days are left to play, any scores waiting for you to confirm, and the next ladder event.\n\n`+
  `LADDER — The live standings for all five draws. Tap anyone's name to see their record and contact info (phone, email, usual availability) so you can set up a match. Turn on "Show UTR" to see UTR ratings. Doubles ladders also show the Top Pairings.\n\n`+
  `PLAY — Challenge a player and submit match scores. There's also a Book a court button that opens Club Automation (courts open 48 hours in advance).\n\n`+
  `PRACTICE — Just want to hit? Post the days and times you're free and the kind of session you want (rally, drills, practice set). Members near your level see it and can tap "I'm in." No points involved.\n\n`+
  `EVENTS — The Monthly Ladder Mixer (last Friday of each month, 6:30 PM), quarterly ladder tournaments, socials and other ladder events. Tap Enter or I'm going to sign up, and add events to your Apple or Google calendar.\n\n`+
  `PROFILE — Add your phone number and when you usually like to play, so other members can reach you. Your full match history is here too.\n\n`+
  `? BUTTON (top right) — The complete rules and FAQ, any time.`+
  H('Challenges')+
  `• You can challenge anyone up to 4 spots above you in the same draw. New members can challenge anyone in their draw for their first ${OPEN_DAYS/7} weeks${seasonStarted()?'':' — and right now, during the free pre-season, everyone can'}.\n`+
  `• Once a challenge is sent you have ${CHALLENGE_DAYS} days to play it. Text each other to pick a time, then book a court.\n`+
  `• Rained out? Tap 🌧️ Rained out on the challenge to reschedule (adds ${RAIN_DAYS} days, once) or cancel with no penalty.\n`+
  `• Matches are best of 3 sets, with a 10-point tiebreak in place of a third set.\n`+
  `• The challenger brings a new can of balls and the winner keeps them (in doubles, the challenging team brings the can).`+
  H('Scores')+
  `• Either player enters the score on the Play tab (for doubles, pick both partners).\n`+
  `• The other side gets a Confirm / Dispute prompt on their Home screen. Once confirmed the rankings update; if they don't respond, it counts automatically after ${CONFIRM_HOURS} hours.\n`+
  `• If a score is wrong, tap Dispute and I'll sort it out.`+
  H('Staying active')+
  `Starting ${seasonLabel()}, if you go ${DECAY_GRACE} days without a confirmed match you'll lose ${DECAY_POINTS} points a week until you play again. The app warns you 10 days ahead. If you're injured or away, just let me know and I'll pause you so you don't lose anything.`+
  H('Tournaments & events')+
  (tourneys.length?`Quarterly ladder tournaments:\n${tourneys.map(e=>`• ${e.title} — ${fmtWhen(e)}`).join('\n')}\n\n`:`There's a ladder tournament at the end of every quarter. `)+
  `Socials and other events will be posted on the Events tab as they're scheduled.`+
  H('Cost')+
  `The ladder is free until the official season starts ${seasonLabel()}. After that it's $10 a month, billed as a house charge on your member account. You can cancel any time by letting me know.`+
  `\n\nAny questions, just reply to this email or find me at the club. See you on the courts!\n\n`+
  `Jordan Boyls\nDirector of Tennis, Gold River Sports Club\njpboyls@gmail.com`;
}
function smsHref(phone,body){ const n=(phone||'').replace(/\D/g,''); const ios=/iPad|iPhone|iPod/.test(navigator.userAgent); return `sms:${n}${ios?'&':'?'}body=${encodeURIComponent(body)}`; }
function openWelcome(id){
  const p=getPlayer(id); if(!p) return;
  const sms=welcomeText(p), mail=welcomeEmail(p);
  const subj=encodeURIComponent('Welcome to the '+LADDER_NAME);
  const pre='white-space:pre-wrap;word-break:break-word;font:13px/1.5 Inter,system-ui,sans-serif;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;margin:8px 0 10px;max-height:260px;overflow:auto';
  $('sheetName').textContent='Send welcome';
  $('sheetBody').innerHTML=`
    <div style="font-size:13.5px;color:var(--fg2);line-height:1.5;margin-bottom:12px"><b style="color:var(--fg)">${esc(p.name)}</b> is on the ladder. Send them a welcome from your phone — it opens Gmail or Messages with everything filled in. <b style="color:var(--fg)">The email is the full guide</b>; the text is the short version.</div>
    <div class="section-head" style="padding-top:4px">Email — setup + full app guide</div>
    <pre style="${pre}" id="welcomeMail">${esc(mail)}</pre>
    <div style="display:grid;gap:8px">
      <a class="btn btn-green btn-full" href="googlegmail:///co?to=${encodeURIComponent(p.email)}&subject=${subj}&body=${encodeURIComponent(mail)}">Email it from the Gmail app</a>
      <a class="btn btn-secondary btn-full" href="mailto:${esc(p.email)}?subject=${subj}&body=${encodeURIComponent(mail)}">Email it from Mail</a>
      <button class="btn btn-secondary btn-full" onclick="copyWelcome(this,'welcomeMail')">Copy email text</button>
    </div>
    <div class="section-head">Text — short version</div>
    <pre style="${pre}" id="welcomeSms">${esc(sms)}</pre>
    <div style="display:grid;gap:8px">
      ${p.phone?`<a class="btn btn-secondary btn-full" href="${esc(smsHref(p.phone,sms))}">Text it to ${esc(p.phone)}</a>`:''}
      <button class="btn btn-secondary btn-full" onclick="copyWelcome(this,'welcomeSms')">Copy text message</button>
      <button class="btn btn-secondary btn-full" style="margin-top:6px" onclick="closeSheet('playerSheet')">Done</button>
    </div>`;
  $('playerSheet').classList.add('open');
}
async function copyWelcome(btn,which){
  const el=$(which||'welcomeMail'); const t=el.textContent;
  try{ await navigator.clipboard.writeText(t); btn.textContent='Copied \u2713'; }
  catch(e){ const r=document.createRange(); r.selectNodeContents(el); const s=getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent='Selected \u2014 tap Copy'; }
}
// ── admin: enter a score for any players (e.g. from a paper score card) ──
function openAdminScore(){
  $('sheetName').textContent='Enter a score';
  const drawOpts=LADDER_ORDER.map(t=>`<option value="${t}">${LADDERS[t].label}</option>`).join('');
  $('sheetBody').innerHTML=`
    <div style="font-size:13px;color:var(--fg2);line-height:1.5;margin-bottom:12px">${JR?'For Matchplay Days, paper score cards or results reported to you. Scores you enter count right away, and the form stays open for the next match.':'For paper score cards or results reported to you. Scores you enter count right away — no confirmation step.'}</div>
    <div class="form-group"><label class="form-label">Draw</label><select id="asDraw" onchange="asFill()">${drawOpts}</select></div>
    <div class="card" style="padding:12px;margin-bottom:12px">
      <div class="form-label" style="margin-bottom:8px">Side 1</div>
      <div class="form-group" style="margin-bottom:8px"><select id="asA1" onchange="asFill(this)"></select></div>
      <div class="form-group as-dbl" style="margin-bottom:0"><select id="asA2" onchange="asFill(this)"></select></div>
    </div>
    <div class="card" style="padding:12px;margin-bottom:12px">
      <div class="form-label" style="margin-bottom:8px">Side 2</div>
      <div class="form-group" style="margin-bottom:8px"><select id="asB1" onchange="asFill(this)"></select></div>
      <div class="form-group as-dbl" style="margin-bottom:0"><select id="asB2" onchange="asFill(this)"></select></div>
    </div>
    <div class="form-group"><label class="form-label">Winner</label>
      <div class="theme-seg" id="asWin"><button type="button" data-w="1" class="on" onclick="asWinner(1)">Side 1</button><button type="button" data-w="2" onclick="asWinner(2)">Side 2</button></div></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Score</label><input type="text" id="asScore" placeholder="6-3, 7-5"></div>
      <div class="form-group"><label class="form-label">Date played</label><input type="date" id="asDate" value="${today()}"></div>
    </div>
    <button class="btn btn-green btn-full" onclick="saveAdminScore()">Save score</button>`;
  $('playerSheet').classList.add('open');
  asFill();
}
let asWin=1;
function asWinner(w){ asWin=w; document.querySelectorAll('#asWin button').forEach(b=>b.classList.toggle('on',+b.dataset.w===w)); }
// fill the four selects so nobody can appear twice; keep existing picks where possible
function asFill(){
  const t=$('asDraw').value, dbl=isDoubles(t), ranked=getRanked(t);
  document.querySelectorAll('.as-dbl').forEach(el=>el.hidden=!dbl);
  const ids=dbl?['asA1','asA2','asB1','asB2']:['asA1','asB1'];
  const ph={asA1:'Player',asA2:'Partner',asB1:'Player',asB2:'Partner'};
  const picked={}; ids.forEach(id=>picked[id]=$(id).value);
  ids.forEach(id=>{
    const taken=ids.filter(o=>o!==id).map(o=>picked[o]).filter(Boolean);
    const opts=ranked.filter(p=>!taken.includes(p.id));
    $(id).innerHTML=`<option value="">${ph[id]}…</option>`+opts.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${isPaper(p)?' 📞':''} (#${ranked.indexOf(p)+1})</option>`).join('');
    if(opts.some(p=>p.id===picked[id])) $(id).value=picked[id];
  });
}
async function saveAdminScore(){
  const t=$('asDraw').value, dbl=isDoubles(t);
  const a1=$('asA1').value, b1=$('asB1').value, a2=dbl?$('asA2').value:null, b2=dbl?$('asB2').value:null;
  const score=$('asScore').value.trim(), date=$('asDate').value;
  if(!a1||!b1||(dbl&&(!a2||!b2))){ toast(dbl?'Pick all four players':'Pick both players'); return; }
  if(!score){ toast('Enter the score'); return; }
  if(!date){ toast('Enter the date played'); return; }
  const winner=asWin===1?a1:b1;
  try{
    await db.collection(COL('matches')).add({p1:a1,p1Partner:a2,p2:b1,p2Partner:b2,ladder:t,score:score.slice(0,40),winner,date,
      submittedBy:state.email,enteredByAdmin:true,status:'confirmed',createdAt:FieldValue.serverTimestamp()});
    state.challenges.filter(c=>isOpenChallenge(c)&&c.ladder===t&&((c.from===a1&&c.to===b1)||(c.from===b1&&c.to===a1)))
      .forEach(c=>db.collection(COL('challenges')).doc(c.id).update({status:'played'}).catch(()=>{}));
    toast(`Saved — ${displayName(winner).split(' ')[0]}${dbl?' & '+displayName(asWin===1?a2:b2).split(' ')[0]:''} win ${score}`);
    $('asScore').value=''; ['asA1','asA2','asB1','asB2'].forEach(id=>{ if($(id)) $(id).value=''; }); asWinner(1); asFill();
  }catch(e){ toast('Could not save: '+e.message); }
}
let pendingPlayerDelete=null;
async function adminDeletePlayer(id){
  if(pendingPlayerDelete!==id){ pendingPlayerDelete=id; toast('Tap Delete again to confirm'); setTimeout(()=>{ if(pendingPlayerDelete===id) pendingPlayerDelete=null; },4000); return; }
  pendingPlayerDelete=null;
  const gone=getPlayer(id);
  try{ await db.collection(COL('players')).doc(id).delete(); if(JR&&gone) await syncFamilies(id,[gone.parent,gone.parent2],[]); toast('Player deleted'); closeSheet('playerSheet'); }catch(e){ toast('Could not delete: '+e.message); }
}
// Marking inactive starts a "hold"; reactivating closes it. Days on hold never count toward inactivity decay.
async function adminToggleActive(id,makeActive){
  const p=getPlayer(id); if(!p) return;
  const upd = makeActive
    ? {active:true, inactiveSince:null, holds:FieldValue.arrayUnion({from:p.inactiveSince||today(), to:today()})}
    : {active:false, inactiveSince:today()};
  try{ await db.collection(COL('players')).doc(id).update(upd); toast(makeActive?'Reactivated \u2014 no points lost for the time away':'Marked inactive \u2014 off the ladder, no decay while away'); closeSheet('playerSheet'); }catch(e){ toast('Could not update: '+e.message); }
}


// ═══════════════════════════════════════════
//  EVENTS (quarterly tournaments, socials, etc.)
// ═══════════════════════════════════════════
const EVENT_TYPES={
  tournament:{label:'Ladder Tournament',icon:'🏆',color:'var(--gold)',bg:'rgba(232,184,75,.15)',join:'Enter',joined:'Entered \u2713',who:'entered'},
  social:{label:'Social',icon:'🎉',color:'var(--purple)',bg:'rgba(155,114,240,.15)',join:"I'm going",joined:'Going \u2713',who:'going'},
  mixer:{label:'Ladder Mixer',icon:'🥂',color:'var(--purple)',bg:'rgba(155,114,240,.15)',join:"I'm in",joined:'In ✓',who:'in'},
  clinic:{label:'Clinic / Drill',icon:'🎾',color:'var(--green)',bg:'rgba(58,170,106,.15)',join:"I'm in",joined:'In \u2713',who:'in'},
  other:{label:'Other',icon:'📌',color:'var(--accent-hi)',bg:'rgba(45,107,228,.15)',join:"I'm going",joined:'Going \u2713',who:'going'}
};
if(JR){ // Matchplay Days first in the junior event list; no monthly mixers
  const rest={...EVENT_TYPES}; delete rest.mixer;
  Object.keys(EVENT_TYPES).forEach(k=>delete EVENT_TYPES[k]);
  Object.assign(EVENT_TYPES,{matchplay:{label:'Matchplay Day',icon:'🎾',color:'var(--green)',bg:'rgba(58,170,106,.15)',join:'Sign up',joined:'Signed up \u2713',who:'signed up'}},rest);
}
let showPast=false;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseDay(d){ const [y,m,dd]=(d||'').split('-').map(Number); return new Date(y,(m||1)-1,dd||1); }
function fmtTime(t){ if(!t) return ''; let [h,m]=t.split(':').map(Number); const ap=h>=12?'PM':'AM'; h=h%12||12; return `${h}${m?':'+String(m).padStart(2,'0'):''} ${ap}`; }
function fmtWhen(e){ const d=parseDay(e.date); const day=d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}); const t=e.start?(fmtTime(e.start)+(e.end?'\u2013'+fmtTime(e.end):'')):''; return day+(t?' \u00b7 '+t:''); }
function upcomingEvents(){ const t=today(); return state.events.filter(e=>(e.date||'')>=t).sort((a,b)=>(a.date+(a.start||'')).localeCompare(b.date+(b.start||''))); }
function pastEvents(){ const t=today(); return state.events.filter(e=>(e.date||'')<t).sort((a,b)=>b.date.localeCompare(a.date)); }
function calStamp(date,time){ return date.replace(/-/g,'')+(time?'T'+time.replace(':','')+'00':''); }
function googleCalUrl(e){
  const allDay=!e.start; const start=calStamp(e.date,e.start);
  let end; if(allDay){ const d=parseDay(e.date); d.setDate(d.getDate()+1); end=d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); } else end=calStamp(e.date,e.end||e.start);
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(e.title)+'&dates='+start+'/'+end+'&ctz=America/Los_Angeles&location='+encodeURIComponent(e.location||'')+'&details='+encodeURIComponent((e.description||'')+'\n\n'+APP_URL);
}
function icsHref(e){
  const esc2=v=>String(v||'').replace(/\\/g,'\\\\').replace(/;/g,'\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
  const allDay=!e.start;
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Gold River Tennis Ladder//EN','BEGIN:VEVENT','UID:'+e.id+'@gold-river-ladder','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z',
    allDay?'DTSTART;VALUE=DATE:'+calStamp(e.date):'DTSTART;TZID=America/Los_Angeles:'+calStamp(e.date,e.start),
    allDay?'':'DTEND;TZID=America/Los_Angeles:'+calStamp(e.date,e.end||e.start),
    'SUMMARY:'+esc2(e.title),'LOCATION:'+esc2(e.location),'DESCRIPTION:'+esc2(e.description),'END:VEVENT','END:VCALENDAR'].filter(Boolean);
  return 'data:text/calendar;charset=utf-8,'+encodeURIComponent(lines.join('\r\n'));
}
function money(n){ return '$'+(Number(n)%1?Number(n).toFixed(2):Number(n)); }
function priceLine(e){
  const p=e.price, mp=e.memberPrice;
  const who=JR?'Ladder players':'Ladder members';
  if(mp!=null&&mp!==''&&p!=null&&p!=='') return `${who} <b>${money(mp)}</b> · Others ${money(p)}`;
  if(mp!=null&&mp!=='') return `${who} <b>${money(mp)}</b>`;
  if(p!=null&&p!=='') return Number(p)===0?'<b>Free</b>':`<b>${money(p)}</b> per player`;
  return '';
}
function eventCard(e,past){
  const T=EVENT_TYPES[e.type]||EVENT_TYPES.other; const d=parseDay(e.date);
  const rsvps=e.rsvps||[]; const mine=rsvps.includes(state.email); const full=e.capacity&&rsvps.length>=e.capacity&&!mine;
  const names=rsvps.map(id=>esc(displayName(id).split(' ')[0])).join(', ');
  return `<div class="ev" id="ev-${e.id}">
    <div class="ev-top">
      <div class="ev-date" style="background:${T.bg}"><div class="mo" style="color:${T.color}">${MONTHS[d.getMonth()]}</div><div class="dy">${d.getDate()}</div></div>
      <div style="flex:1;min-width:0">
        <span class="ev-type" style="background:${T.bg};color:${T.color}">${T.icon} ${T.label}</span>
        <div class="ev-title">${esc(e.title)}</div>
        <div class="ev-meta">${esc(fmtWhen(e))}${e.location?'<br>'+esc(e.location):''}</div>
        ${e.eligibility?`<div class="ev-meta" style="color:var(--fg)"><b>Who:</b> ${esc(e.eligibility)}</div>`:''}
        ${priceLine(e)?`<div class="ev-meta" style="color:var(--fg)">💵 ${priceLine(e)}</div>`:''}
      </div>
    </div>
    ${e.description?`<div class="ev-desc">${esc(e.description)}</div>`:''}
    ${e.rsvpOn!==false?`<div class="ev-meta" style="margin-top:8px">${rsvps.length?`<b style="color:var(--fg)">${rsvps.length}${e.capacity?' / '+e.capacity:''}</b> ${T.who}: ${names}`:(e.capacity?`0 / ${e.capacity} spots taken`:'Nobody yet \u2014 be the first')}</div>`:''}
    <div class="ev-actions">
      ${!past&&e.rsvpOn!==false&&me()?`<button class="btn ${mine?'btn-secondary':'btn-primary'} btn-sm" ${full?'disabled style="opacity:.5"':''} onclick="toggleRsvp('${e.id}')">${mine?T.joined:(full?'Full':T.join)}</button>`:''}
      ${!past?`<a class="btn btn-secondary btn-sm" href="${icsHref(e)}" download="${esc((e.title||'event').replace(/[^\w\- ]/g,''))}.ics">Apple Calendar</a><a class="btn btn-secondary btn-sm" href="${googleCalUrl(e)}" target="_blank" rel="noopener">Google Calendar</a>`:''}
      ${state.isAdmin?`<button class="btn btn-secondary btn-sm" onclick="openEventForm('${e.id}')">Edit</button>`:''}
    </div>
  </div>`;
}
function renderEvents(){
  $('addEventBtn').hidden=!state.isAdmin;
  const up=upcomingEvents();
  $('eventList').innerHTML=up.length?`<div class="card">${up.map(e=>eventCard(e,false)).join('')}</div>`
    :`<div class="empty"><div class="empty-icon">📅</div><div class="empty-title">No upcoming events yet</div><div class="empty-sub">${JR?(state.isAdmin?'Add a Matchplay Day or junior event with + Add event.':'Matchplay Days and junior events will show up here.'):state.isAdmin?'Add a social or set up the quarterly tournaments.':'Quarterly tournaments and socials will show up here.'}</div></div>`;
  const hasQ = state.events.some(e=>e.type==='tournament'&&(e.date||'').startsWith('2027'));
  const hasMixers = state.events.some(e=>e.type==='mixer');
  const boxes=[];
  if(state.isAdmin&&!hasMixers&&!JR){
    const moved=MIXER_DATES.filter(x=>x[1]&&x[0]>=today()).map(x=>`${fmtShort(dayMs(x[0]))} (${x[1]})`);
    boxes.push(`<div class="card" style="padding:14px 16px;border-color:var(--purple)">
      <div style="font-weight:700">🥂 Set up the Monthly Ladder Mixers</div>
      <div style="font-size:12.5px;color:var(--fg2);margin:4px 0 10px;line-height:1.5">Adds a mixer on the last Friday of every month through December 2027, 6:30–9:00 PM, $10 per player, with sign-up. Holiday clashes move earlier: ${moved.join('; ')}. You can edit or delete any of them afterwards.</div>
      <button class="btn btn-primary btn-sm" onclick="seedMixers()">Add the mixers</button></div>`);
  }
  if(state.isAdmin&&!hasQ&&!JR) boxes.push(`<div class="card" style="padding:14px 16px;border-color:var(--gold)">
      <div style="font-weight:700">🏆 Set up the 2027 quarterly tournaments</div>
      <div style="font-size:12.5px;color:var(--fg2);margin:4px 0 10px;line-height:1.5">Adds four tournaments: Sat Mar 27, Sat Jun 26, Sat Sep 25 and Sat Dec 18 (moved off Christmas). You can edit any date, time or detail afterwards.</div>
      <button class="btn btn-primary btn-sm" onclick="seedQuarterlies()">Add all four</button></div>`);
  $('seedBox').hidden=!boxes.length;
  $('seedBox').innerHTML=boxes.join('<div style="height:10px"></div>');
  const past=pastEvents();
  $('pastToggle').hidden=!past.length;
  $('pastToggle').textContent=showPast?'Hide past events':`Show past events (${past.length})`;
  $('pastList').hidden=!showPast;
  $('pastList').innerHTML=showPast&&past.length?`<div class="card" style="opacity:.8">${past.map(e=>eventCard(e,true)).join('')}</div>`:'';
}
function togglePast(){ showPast=!showPast; renderEvents(); }
function renderHomeEvent(){
  const el=$('homeEvent'); if(!el) return;
  const e=upcomingEvents()[0];
  if(!e){ el.innerHTML=''; return; }
  const T=EVENT_TYPES[e.type]||EVENT_TYPES.other; const d=parseDay(e.date); const going=(e.rsvps||[]).includes(state.email);
  el.innerHTML=`<div class="section-head">Next Ladder Event</div>
    <div class="card" style="padding:12px 14px;cursor:pointer;border-left:3px solid ${T.color}" onclick="goPage('Events',$('navEvents'))">
      <div style="display:flex;gap:12px;align-items:center">
        <div class="ev-date" style="background:${T.bg}"><div class="mo" style="color:${T.color}">${MONTHS[d.getMonth()]}</div><div class="dy">${d.getDate()}</div></div>
        <div style="flex:1;min-width:0"><div class="ev-title">${T.icon} ${esc(e.title)}</div><div class="ev-meta">${esc(fmtWhen(e))}${priceLine(e)?' · '+priceLine(e):''}</div>
          ${going?`<div class="ev-meta" style="color:var(--green);font-weight:600">You\u2019re ${T.who==='entered'?'entered':'going'} \u2713</div>`:''}</div>
        <span style="color:var(--fg2);font-size:20px">\u203a</span>
      </div></div>`;
}
async function toggleRsvp(id){
  const e=state.events.find(x=>x.id===id); if(!e) return;
  const mine=(e.rsvps||[]).includes(state.email); const T=EVENT_TYPES[e.type]||EVENT_TYPES.other;
  if(!mine&&e.capacity&&(e.rsvps||[]).length>=e.capacity){ toast('Sorry \u2014 this one is full'); return; }
  try{ await db.collection(COL('events')).doc(id).update({rsvps:mine?FieldValue.arrayRemove(state.email):FieldValue.arrayUnion(state.email)}); toast(mine?'Removed':(e.type==='tournament'?'You’re entered! 🏆':e.type==='mixer'?'See you at the mixer! 🎾':'See you there! 🎉')); }
  catch(err){ toast('Could not update: '+err.message); }
}
function openEventForm(id){
  const e=id?state.events.find(x=>x.id===id):null;
  const v=k=>esc(e&&e[k]!=null?e[k]:'');
  $('sheetName').textContent=e?'Edit event':'New event';
  $('sheetBody').innerHTML=`
    <div class="form-group"><label class="form-label">Type</label>
      <select id="evType" onchange="$('evEligGroup').hidden=this.value!=='tournament'; if(this.value==='mixer'&&!$('evDesc').value){ $('evDesc').value=MIXER_DESC; $('evStart').value='18:30'; $('evEnd').value='21:00'; $('evPrice').value=10; }">
        ${Object.entries(EVENT_TYPES).map(([k,T])=>`<option value="${k}" ${(e?e.type:(JR?'matchplay':'social'))===k?'selected':''}>${T.icon} ${T.label}</option>`).join('')}
      </select></div>
    <div class="form-group"><label class="form-label">Title</label><input type="text" id="evTitle" value="${v('title')}" placeholder="e.g. Holiday Ladder Mixer"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Date</label><input type="date" id="evDate" value="${v('date')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Start (optional)</label><input type="time" id="evStart" value="${v('start')}"></div>
      <div class="form-group"><label class="form-label">End (optional)</label><input type="time" id="evEnd" value="${v('end')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Location</label><input type="text" id="evLoc" value="${e?v('location'):'Gold River Sports Club'}"></div>
    <div class="form-group" id="evEligGroup" ${(e?e.type:'social')==='tournament'?'':'hidden'}><label class="form-label">Who can enter</label><input type="text" id="evElig" value="${v('eligibility')}" placeholder="e.g. Top 8 in each draw as of the Friday before"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Price per player</label><input type="number" id="evPrice" min="0" step="0.01" inputmode="decimal" value="${v('price')}" placeholder="e.g. 20"></div>
      <div class="form-group"><label class="form-label">Ladder-member price</label><input type="number" id="evMPrice" min="0" step="0.01" inputmode="decimal" value="${v('memberPrice')}" placeholder="Optional, e.g. 15"></div>
    </div>
    <div class="form-group"><label class="form-label">Details</label><textarea id="evDesc" rows="4" placeholder="Format, food & drinks, what to bring, cost…">${v('description')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label style="display:flex;align-items:center;gap:8px;font-size:14px;margin-top:22px"><input type="checkbox" id="evRsvp" style="width:auto" ${!e||e.rsvpOn!==false?'checked':''}> Members can sign up</label></div>
      <div class="form-group"><label class="form-label">Spots (optional)</label><input type="number" id="evCap" min="1" value="${v('capacity')}" placeholder="No limit"></div>
    </div>
    <div style="display:grid;gap:8px;margin-top:4px">
      <button class="btn btn-primary btn-full" onclick="saveEvent(${e?`'${e.id}'`:'null'})">${e?'Save changes':'Add event'}</button>
      ${e?`<button class="btn btn-secondary btn-full" style="color:var(--red)" onclick="deleteEvent('${e.id}')">Delete event</button>`:''}
      ${e&&(e.rsvps||[]).length?`<div style="font-size:12.5px;color:var(--fg2);line-height:1.5;margin-top:6px"><b style="color:var(--fg)">Signed up (${e.rsvps.length}):</b> ${e.rsvps.map(id=>esc(displayName(id))).join(', ')}</div>`:''}
    </div>`;
  $('playerSheet').classList.add('open');
}
async function saveEvent(id){
  const title=$('evTitle').value.trim(), date=$('evDate').value;
  if(!title){ toast('Give the event a title'); return; }
  if(!date){ toast('Pick a date'); return; }
  const cap=parseInt($('evCap').value,10);
  const data={type:$('evType').value,title:title.slice(0,100),date,start:$('evStart').value||'',end:$('evEnd').value||'',location:$('evLoc').value.trim().slice(0,120),
    eligibility:$('evType').value==='tournament'?$('evElig').value.trim().slice(0,160):'',description:$('evDesc').value.trim().slice(0,1500),
    rsvpOn:$('evRsvp').checked,capacity:cap>0?cap:null,
    price:$('evPrice').value===''?null:Math.max(0,parseFloat($('evPrice').value)),
    memberPrice:$('evMPrice').value===''?null:Math.max(0,parseFloat($('evMPrice').value))};
  try{
    if(id) await db.collection(COL('events')).doc(id).update(data);
    else await db.collection(COL('events')).add({...data,rsvps:[],createdBy:state.email,createdAt:FieldValue.serverTimestamp()});
    closeSheet('playerSheet'); toast(id?'Event updated':'Event added 📅');
  }catch(err){ toast('Could not save: '+err.message); }
}
let pendingEventDelete=null;
async function deleteEvent(id){
  if(pendingEventDelete!==id){ pendingEventDelete=id; toast('Tap Delete again to confirm'); setTimeout(()=>{ if(pendingEventDelete===id) pendingEventDelete=null; },4000); return; }
  pendingEventDelete=null;
  try{ await db.collection(COL('events')).doc(id).delete(); closeSheet('playerSheet'); toast('Event deleted'); }catch(err){ toast('Could not delete: '+err.message); }
}
// Last Friday of each month, 6:30 PM. Holiday clashes move a week (or two) earlier.
const MIXER_DATES=[
  ['2026-11-20','moved from Nov 27, the day after Thanksgiving'],
  ['2026-12-18','moved from Dec 25, Christmas Day'],
  ['2027-01-29'],['2027-02-26'],['2027-03-26'],['2027-04-30'],['2027-05-28'],['2027-06-25'],
  ['2027-07-30'],['2027-08-27'],['2027-09-24'],['2027-10-29'],
  ['2027-11-19','moved from Nov 26, the day after Thanksgiving'],
  ['2027-12-17','moved from Dec 31, New Year’s Eve']
];
const MIXER_DESC='Drop-in point play, food and drinks — come socialize and play. Matches you play can count toward the ladder (just enter the score in the app afterwards), or use the night to hit and practice with other members. All levels welcome; come and go as you like.';
function mixerTitle(date){ return new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'long'})+' Ladder Mixer'; }
async function seedMixers(){
  const have=new Set(state.events.filter(e=>e.type==='mixer').map(e=>e.date));
  const todo=MIXER_DATES.filter(([d])=>!have.has(d)&&d>=today());
  try{
    for(const [date] of todo){
      await db.collection(COL('events')).add({type:'mixer',title:mixerTitle(date),date,start:'18:30',end:'21:00',location:'Gold River Sports Club',
        eligibility:'',description:MIXER_DESC,price:10,memberPrice:null,rsvpOn:true,capacity:null,rsvps:[],series:'mixer',createdBy:state.email,createdAt:FieldValue.serverTimestamp()});
    }
    toast(`${todo.length} monthly mixers added 🥂`);
  }catch(err){ toast('Could not add: '+err.message); }
}
async function seedQuarterlies(){
  const qs=[['2027-03-27','Q1'],['2027-06-26','Q2'],['2027-09-25','Q3'],['2027-12-18','Q4']];
  try{
    for(const [date,q] of qs){
      await db.collection(COL('events')).add({type:'tournament',title:`${q} Ladder Tournament`,date,start:'08:00',end:'16:00',location:'Gold River Sports Club',
        eligibility:'All active ladder players \u2014 seeded by current ladder rank',description:'Quarterly ladder tournament across all five draws. Format and draw sizes will be posted closer to the date.',
        rsvpOn:true,capacity:null,rsvps:[],createdBy:state.email,createdAt:FieldValue.serverTimestamp()});
    }
    toast('2027 quarterly tournaments added 🏆');
  }catch(err){ toast('Could not add: '+err.message); }
}

// ═══════════════════════════════════════════
//  RULES & FAQ  (numbers come from the rule constants, so this page never drifts)
// ═══════════════════════════════════════════
function renderRules(){
  const el=$('rulesBody'); if(!el) return;
  const sig=state.events.filter(e=>e.type==='tournament').map(e=>e.id+e.date+e.title).join('|');
  if(el.dataset.sig===sig&&el.innerHTML) return;
  const seasonDay=new Date(SEASON_START+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  if(JR){ el.innerHTML=jrRulesHtml(seasonDay); el.dataset.sig=sig; return; }
  const q=(title,body,open)=>`<details${open?' open':''}><summary>${title}</summary><div class="rules-ans">${body}</div></details>`;
  const sec=(title,items)=>`<div class="rules-sec"><h2>${title}</h2><div class="rules-card">${items.join('')}</div></div>`;
  const tourneys=state.events.filter(e=>e.type==='tournament'&&(e.date||'')>=today()).sort((a,b)=>a.date.localeCompare(b.date));
  el.innerHTML=`
  <div class="rules-key">
    <div><b>+${WIN} / ${LOSS}</b><span>points for a win / loss</span></div>
    <div><b>${CHALLENGE_DAYS} days</b><span>to play a challenge</span></div>
    <div><b>${CONFIRM_HOURS} hrs</b><span>to confirm a score</span></div>
    <div><b>${DECAY_GRACE} days</b><span>before inactivity slide</span></div>
  </div>
  ${sec('The basics',[
    q('Who can join?',`<p>Gold River and club-wide Spare Time members who are 18 or older. Sign up with the form at the front desk or by scanning the QR code on the flyer; Jordan adds you to the ladder and texts or emails you a welcome with the app link.</p>`,true),
    q('What are the five draws?',`<p>Men’s Singles, Women’s Singles, Men’s Doubles, Women’s Doubles, and Mixed Doubles. You can be in as many as you like. Singles and doubles are split into men’s and women’s draws based on the placement you chose when signing up; Mixed is open to everyone.</p>`),
    q('How are rankings decided?',`<p>Everyone has points in each draw they play. Rankings are simply who has the most points.</p><ul><li>Win a match: <b>+${WIN} points</b></li><li>Lose a match: <b>${LOSS} points</b></li></ul><p>Your starting points come from your level when you join (USTA 2.5 = ${NTRP_BASE['2.5']}, 3.0 = ${NTRP_BASE['3.0']}, 3.5 = ${NTRP_BASE['3.5']}, 4.0 = ${NTRP_BASE['4.0']}, 4.5 = ${NTRP_BASE['4.5']}, 5.0+ = ${NTRP_BASE['5.0']}). Jordan may adjust a starting point if someone is clearly placed too high or low.</p>`),
    q('Can I play without the app?',`<p>Yes. Tell Jordan when you sign up and you'll be added as a 📞 paper player, with no email or smartphone needed. Other members will call or text you to set up matches, and the weekly standings are posted on the bulletin board.</p><p>After a match, fill out a <b>Match Score Card</b> from the front desk, have your opponent initial it, and leave it in Jordan Boyls' box. Jordan enters it, and it counts right away.</p>`),
    q('What’s a social membership?',`<p>For members who want the people and the events, not the rankings. Social members aren’t ranked, but they get the <b>Practice</b> board to find games, sign-up for the <b>Monthly Ladder Mixer</b> and other socials, and ladder-member pricing. You can switch into a ranked draw any time by asking Jordan.</p>`),
    q('How does doubles ranking work?',`<p>Doubles is ranked individually, so you can play with different partners. When you win, you and your partner each get +${WIN}; the losing pair each get ${LOSS}. The <b>Top Pairings</b> list on each doubles ladder shows which partnerships have the best record together.</p>`),
  ])}
  ${sec('Challenges & matches',[
    q('Who can I challenge?',`<p>Anyone up to <b>4 spots above you</b> in the same draw. The Play tab only lists the people you’re allowed to challenge.</p><p><b>New members</b> can challenge <b>anyone in their draw</b> for their first ${OPEN_DAYS/7} weeks, to find their level quickly. Everyone has this open window during the free pre-season and the first ${OPEN_DAYS/7} weeks of the season.</p>`),
    q('How long do we have to play?',`<p><b>${CHALLENGE_DAYS} days</b> from when the challenge is sent. Each challenge on your Home screen shows how much time is left. If it isn’t played in time, Jordan can award the challenger a forfeit win or void the challenge.</p><p>If injury or travel gets in the way, message Jordan before the ${CHALLENGE_DAYS} days are up. For rain, use the 🌧️ Rained out button (below).</p>`),
    q('What if we get rained out?',`<p>Tap <b>🌧️ Rained out</b> on the accepted challenge (Home screen). Either player can do it, and you get two choices:</p><p><b>Reschedule</b> adds ${RAIN_DAYS} days to the play-by date (you can enter the new date too). Each challenge can be rescheduled once.<br><b>Cancel</b> closes the challenge with no penalty and no effect on the rankings. Either of you can send a new challenge any time.</p><p>Courts are booked through Club Automation as usual. Jordan sees every rain-out, so there's no need to message him.</p>`),
    q('Can I decline a challenge?',`<p>Yes, if you can’t play — let the challenger know why. Jordan may treat repeated declines as forfeits.</p>`),
    q('How do we book a court?',`<p>Through Club Automation, the same way you always do. Courts can be booked <b>up to 48 hours in advance</b>.</p><p>Tap <b>Book a court</b> on the Play tab, or on an accepted challenge to open the booking page on your proposed date. If that date is more than 48 hours away, agree on the time with your opponent now and book once it opens up.</p>`),
    q('What’s the match format?',`<p>Best of 3 sets, with a 10-point tiebreak in place of a third set.</p>`),
    q('Who brings the balls?',`<p><b>The challenger brings a new can, and the winner keeps them.</b> In doubles, the challenging team brings the can.</p><p>For a match that isn’t from a challenge, like one played at a mixer, agree on it before you start.</p>`),
    q('How do I record a score?',`<p>Either player goes to <b>Play → Submit Match Score</b> and enters the result. For doubles, pick both partners. The match then shows as <b>Awaiting confirmation</b>.</p>`),
    q('Why hasn’t my score counted yet?',`<p>Every score has to be confirmed by the other side. They’ll see it at the top of their Home screen with <b>Confirm</b> and <b>Dispute</b> buttons. If they don’t respond within <b>${CONFIRM_HOURS} hours</b>, it counts automatically.</p>`),
    q('What if a score is wrong?',`<p>Tap <b>Dispute</b> instead of Confirm. The match won’t count, and Jordan will sort it out with both players. If you entered a score by mistake, message Jordan and he’ll delete it.</p>`),
  ])}
  ${sec('Staying active',[
    q('What happens if I don’t play for a while?',`<p>Starting <b>${seasonDay}</b>, if you go <b>${DECAY_GRACE} days</b> without a confirmed match, you lose <b>${DECAY_POINTS} points a week</b> until you play again (at most ${DECAY_CAP} points per idle stretch). Playing stops the slide, but points already lost don’t come back. It keeps the ladder moving so the top spots go to people who are playing.</p><p>You’ll get a heads-up on your Home screen 10 days before you’d start sliding.</p>`),
    q('Does losing by forfeit count as playing?',`<p>No. A forfeit win keeps the winner active, but a forfeit loss doesn’t reset the inactivity clock.</p>`),
    q('I’m injured or away — what should I do?',`<p>Let Jordan know. He can mark you inactive so you drop off the ladder without losing points, and bring you back when you’re ready.</p>`),
  ])}
  ${sec('Practice, events & tournaments',[
    q('What’s the Practice tab?',`<p>A place to find hitting partners, with no points involved. Post the days and times you’re free and the kind of session you want; members within your chosen level range see it under <b>Matches My Level</b> and can tap <b>I’m in</b>.</p>`),
    q('When are the quarterly tournaments?',tourneys.length?`<p>${tourneys.map(e=>`<b>${esc(e.title)}</b> — ${esc(fmtWhen(e))}`).join('<br>')}</p><p>Details, eligibility and sign-up are on the <b>Events</b> tab.</p>`:`<p>One at the end of each quarter. Dates, eligibility and sign-up will be posted on the <b>Events</b> tab.</p>`),
    q('What’s the Monthly Ladder Mixer?',`<p>A drop-in social on the <b>last Friday of every month at 6:30 PM</b>: point play, food and drinks. Matches you play can count toward the ladder (enter the score in the app afterwards), or just use it to hit and meet other members. <b>$10 per player.</b> Sign up on the Events tab so Jordan knows how many to expect.</p>`),
    q('How do I sign up for an event?',`<p>Open the <b>Events</b> tab and tap <b>Enter</b> (tournaments) or <b>I’m going</b> (socials). You can also add it to your Apple or Google calendar from there.</p>`),
  ])}
  ${sec('Fees',[
    q('How much does it cost?',`<p>The ladder is <b>free until ${seasonDay}</b>, when the official season starts. After that it’s <b>$10 a month</b>, billed as a house charge on your member account.</p><p>Join after the season starts and your first month is free.</p>`),
    q('How do I cancel?',`<p>Let Jordan know. Billing stops at the end of that month.</p>`),
  ])}
  ${sec('Using the app',[
    q('How do I sign in?',`<p>Enter your email and tap <b>Email me a sign-in link</b>. On iPhone, if you opened the ladder from your home screen, don’t tap the link in the email — press and hold it, choose <b>Copy Link</b>, then paste it into the box on the sign-in screen. You stay signed in after that.</p>`),
    q('How do I put the app on my home screen?',`<p>iPhone: open the link in Safari, tap the Share button, then <b>Add to Home Screen</b>. Android: open it in Chrome, tap the ⋮ menu, then <b>Add to Home screen</b> or <b>Install app</b>. Full steps are under <b>Profile → Install on your phone</b>.</p>`),
    q('Will I get notifications?',`<p>Not yet. Open the app to check for new challenges, scores to confirm and practice requests — they’re all on your Home screen.</p>`),
    q('How do other members contact me?',`<p>Through the phone number and email on your profile. Update your number and usual availability under <b>Profile → My contact info</b>.</p>`),
    q('The app looks out of date',`<p>Close it completely and reopen it. Updates usually appear within a few minutes.</p>`),
    q('Who do I contact with questions?',`<p>Jordan Boyls, Director of Tennis — <span style="user-select:all;color:var(--accent-hi);font-weight:600">jpboyls@gmail.com</span></p>`),
  ])}`;
  el.dataset.sig=sig;
}

// ═══════════════════════════════════════════
//  PRINT STANDINGS (admin) — live data, 2 pages: singles / doubles
// ═══════════════════════════════════════════
const PRINT_COLOR={singles:'#1c52c7',doubles:'#17713f',mixed:'#5b2fc2'};
function kindOf(t){ return !isDoubles(t)?'singles':t==='mx'?'mixed':'doubles'; }
function moveHtml(id,t,prev){
  const now=getRanked(t).findIndex(p=>p.id===id)+1, was=prev.indexOf(id)+1;
  if(!was) return '<span class="pv-eq">•</span>';
  const d=was-now; return d>0?`<span class="pv-up">▲${d}</span>`:d<0?`<span class="pv-dn">▼${-d}</span>`:'<span class="pv-eq">–</span>';
}
function printRows(t,list,start,prev){
  return list.map((p,i)=>{
    const rk=start+i, rec=record(p), utr=getUTR(p,t), idle=decayPenalty(p);
    return `<tr class="${rk<=3?'pv-top':''}"><td class="pv-rk">${rk}</td><td class="pv-mv">${moveHtml(p.id,t,prev)}</td>
      <td class="pv-nm">${esc(p.name)}${isNewMember(p)?'<span class="pv-tag pv-new">NEW</span>':''}${idle?`<span class="pv-tag pv-idle">−${idle} idle</span>`:''}</td>
      <td class="pv-c">${esc(p.ntrp)}</td><td class="pv-c">${utr!=null&&utr!==''?Number(utr).toFixed(2):'—'}</td><td class="pv-c">${rec.w}–${rec.l}</td>
      <td class="pv-pts" style="color:${PRINT_COLOR[kindOf(t)]}">${getRating(p,t)}</td></tr>`;}).join('');
}
function printTable(t,list,start,prev){
  return `<table><thead><tr><th class="pv-rk">#</th><th class="pv-mv"></th><th>Player</th><th class="pv-c">${JR?'Ball':'NTRP'}</th><th class="pv-c">UTR</th><th class="pv-c">W–L</th><th class="pv-pts">Pts</th></tr></thead>
    <tbody>${printRows(t,list,start,prev)}</tbody></table>`;
}
function printPairs(t){
  const ps=pairingStats(t).slice(0,3).filter(s=>s.ids.every(getPlayer));
  if(!ps.length) return '';
  const short=id=>{ const n=displayName(id).split(' '); return n[0]+(n[1]?' '+n[1][0]+'.':''); };
  return `<div class="pv-pairs"><b>Top pairings</b> ${ps.map(s=>`${esc(short(s.ids[0]))} &amp; ${esc(short(s.ids[1]))} <span>${s.wins}–${s.losses}</span>`).join(' · ')}</div>`;
}
function printDraw(t,prev,split){
  const list=getRanked(t); if(!list.length) return '';
  const c=PRINT_COLOR[kindOf(t)];
  const head=`<div class="pv-dh" style="border-color:${c}"><h2 style="color:${c}">${LADDERS[t].label}</h2><span>${list.length} player${list.length===1?'':'s'}</span></div>`;
  if(split&&list.length>8){ const h=Math.ceil(list.length/2);
    return `<section class="pv-draw pv-wide">${head}<div class="pv-split">${printTable(t,list.slice(0,h),1,prev)}${printTable(t,list.slice(h),h+1,prev)}</div>${printPairs(t)}</section>`; }
  return `<section class="pv-draw${split?' pv-wide':''}">${head}${printTable(t,list,1,prev)}${printPairs(t)}</section>`;
}
// Fun, non-competitive recognition over the last 30 days.
function funAwards(){
  const since=Date.now()-30*DAY, recent=state.matches.filter(m=>counts(m)&&dayMs(m.date)>=since);
  const cnt={}, people={}, weeks={};
  recent.forEach(m=>{
    const all=[m.p1,m.p1Partner,m.p2,m.p2Partner].filter(Boolean);
    const wk=Math.floor((Date.now()-dayMs(m.date))/(7*DAY));
    all.forEach(id=>{ cnt[id]=(cnt[id]||0)+1; (people[id]=people[id]||new Set()); all.forEach(o=>{ if(o!==id) people[id].add(o); }); (weeks[id]=weeks[id]||new Set()).add(wk); });
  });
  const real=id=>getPlayer(id)&&!getPlayer(id).social;
  const out=[];
  const most=Object.entries(cnt).filter(([id])=>real(id)).sort((a,b)=>b[1]-a[1]);
  if(most.length) out.push({key:'most',icon:'🎾',title:'Most Matches',id:most[0][0],detail:`${most[0][1]} match${most[0][1]===1?'':'es'}`,runners:most.slice(1,3).map(([id,n])=>`${displayName(id)} · ${n}`)});
  const bfly=Object.entries(people).filter(([id])=>real(id)).map(([id,s])=>[id,s.size]).sort((a,b)=>b[1]-a[1]);
  if(bfly.length&&bfly[0][1]>=2) out.push({key:'butterfly',icon:'🦋',title:'Social Butterfly',id:bfly[0][0],detail:`played with ${bfly[0][1]} different people`,runners:bfly.slice(1,3).map(([id,n])=>`${displayName(id)} · ${n}`)});
  let best=null;
  LADDER_ORDER.forEach(t=>{ const prev=ranksAsOf(t,since), now=getRanked(t).map(p=>p.id);
    now.forEach((id,i)=>{ const w=prev.indexOf(id); if(w<0) return; const gain=w-i; if(gain>0&&(!best||gain>best.gain)) best={id,gain,t,now:i+1}; }); });
  if(best) out.push({key:'climber',icon:'📈',title:'Biggest Climber',id:best.id,detail:`up ${best.gain} in ${LADDERS[best.t].label} · now #${best.now}`,gain:best.gain,t:best.t,now:best.now});
  const every=Object.entries(weeks).filter(([id,w])=>real(id)&&[0,1,2,3].every(k=>w.has(k))).map(([id])=>id);
  if(every.length) out.push({key:'every',icon:'🔥',title:'Every-Week Club',id:every[0],detail:'played every week this month',all:every});
  return out;
}
function renderHomeAwards(){
  const el=$('homeAwards'); if(!el) return;
  const aw=funAwards();
  if(!aw.length){ el.innerHTML=''; return; }
  el.innerHTML=`<div class="section-head">This month on the ladder</div><div class="card">${aw.map(a=>`
    <div class="rank-card" style="cursor:pointer" onclick="openPlayerSheet('${esc(a.id)}')">
      <div style="font-size:24px;width:32px;text-align:center;flex-shrink:0">${a.icon}</div>
      <div class="rank-info"><div style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--fg2)">${a.title}</div>
        <div class="rank-name">${a.key==='every'&&a.all.length>1?esc(a.all.slice(0,3).map(id=>displayName(id).split(' ')[0]).join(', '))+(a.all.length>3?` +${a.all.length-3} more`:''):esc(displayName(a.id))}</div>
        <div class="rank-meta">${esc(a.detail)}</div></div>
    </div>`).join('')}</div>`;
}
function printHighlights(){
  const cards=[];
  const ev=upcomingEvents()[0];
  if(ev){ const T=EVENT_TYPES[ev.type]||EVENT_TYPES.other;
    cards.push(`<div><div class="pv-lbl">Next up</div><div class="pv-big" style="color:${ev.type==='tournament'?'#8a5a00':'#5b2fc2'}">${T.icon} ${esc(ev.title)}</div><div class="pv-sub">${esc(fmtWhen(ev))} · sign up in the app (Events tab)</div></div>`); }
  const since=Date.now()-30*DAY, cnt={};
  state.matches.filter(m=>counts(m)&&dayMs(m.date)>=since).forEach(m=>[m.p1,m.p1Partner,m.p2,m.p2Partner].filter(Boolean).forEach(id=>cnt[id]=(cnt[id]||0)+1));
  const top=Object.entries(cnt).filter(([id])=>getPlayer(id)).sort((a,b)=>b[1]-a[1]).slice(0,3);
  if(top.length) cards.push(`<div><div class="pv-lbl">Most matches</div><div class="pv-big">${esc(displayName(top[0][0]))} · ${top[0][1]}</div><div class="pv-sub">${top.slice(1).map(([id,n])=>`${esc(displayName(id))} · ${n}`).join(' &nbsp;·&nbsp; ')||'&nbsp;'}</div></div>`);
  let best=null;
  LADDER_ORDER.forEach(t=>{ const prev=ranksAsOf(t,since), now=getRanked(t).map(p=>p.id);
    now.forEach((id,i)=>{ const w=prev.indexOf(id); if(w<0) return; const gain=w-i; if(gain>0&&(!best||gain>best.gain)) best={id,gain,t,now:i+1}; }); });
  const fa=funAwards(), bf=fa.find(a=>a.key==='butterfly');
  if(bf) cards.push(`<div><div class="pv-lbl">🦋 Social butterfly</div><div class="pv-big" style="color:#5b2fc2">${esc(displayName(bf.id))}</div><div class="pv-sub">${esc(bf.detail)}</div></div>`);
  if(best) cards.push(`<div><div class="pv-lbl">Biggest climber</div><div class="pv-big" style="color:#17713f">▲${best.gain} ${esc(displayName(best.id))}</div><div class="pv-sub">${LADDERS[best.t].label} · now #${best.now}</div></div>`);
  return cards.length?`<div class="pv-hl" style="grid-template-columns:repeat(${cards.length},1fr)">${cards.join('')}</div>`:'';
}
// layout: which blocks go on which page. Default is 2 pages; Mixed gets its own page and the highlights
// strip is dropped if they don't fit (openPrintStandings measures and retries).
function buildStandings(layout){
  layout=layout||{mixedOwnPage:false,highlights:true};
  const total=layout.mixedOwnPage?3:2;
  const asOf=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const weekAgo=Date.now()-7*DAY; const prev={}; LADDER_ORDER.forEach(t=>prev[t]=ranksAsOf(t,weekAgo));
  const head=n=>`<header class="pv-header"><div><div class="pv-club">GOLD RIVER SPORTS CLUB</div><h1>${JR?'Junior Tennis Ladder Standings':'Tennis Ladder Standings'}</h1><div class="pv-asof">As of ${esc(asOf)} · Page ${n} of ${total}</div></div></header>`;
  const foot=`<footer class="pv-footer"><img src="qr-signup.png" alt="">
    <div class="pv-how"><b>How it works:</b> Win +${WIN} · Loss ${LOSS} · Challenge up to 4 spots above you · Play within ${CHALLENGE_DAYS} days · Scores confirmed in the app within ${CONFIRM_HOURS} hours · After ${DECAY_GRACE} days without a match, −${DECAY_POINTS} points a week.<br><b>Not on the ladder yet?</b> Scan the code to sign up. Live standings, challenges and scores are in the ladder app.</div>
    <div class="pv-key"><span class="pv-up">▲</span> moved up · <span class="pv-dn">▼</span> moved down<br>in the last 7 days · <span class="pv-eq">•</span> new<br>Highlights: last 30 days<br><span class="pv-tag pv-new">NEW</span> joined recently</div></footer>`;
  const page=(n,body)=>`<div class="pv-page">${head(n)}<div class="pv-cols">${body}</div>${foot}</div>`;
  if(JR){ // page 1: Orange, Green, 14U · page 2: 16U, 18U (+ doubles, or doubles on its own page)
    const d=t=>printDraw(t,prev[t]);
    const q1=`${d('o10')}${d('g12')}${d('b14')}${d('g14')}${layout.highlights?printHighlights():''}`;
    const jd=printDraw('jd',prev.jd,true);
    const q2=`${d('b16')}${d('g16')}${d('b18')}${d('g18')}${layout.mixedOwnPage?'':jd}`;
    return page(1,q1)+page(2,q2)+(layout.mixedOwnPage?page(3,jd):'');
  }
  const p1=`${printDraw('ms',prev.ms)}${printDraw('ws',prev.ws)}${layout.highlights?printHighlights():''}`;
  const mx=printDraw('mx',prev.mx,true);
  const p2=`${printDraw('md',prev.md)}${printDraw('wd',prev.wd)}${layout.mixedOwnPage?'':mx}`;
  return page(1,p1)+page(2,p2)+(layout.mixedOwnPage?page(3,mx):'');
}
const PAGE_PX=1056; // 11in at 96px/in
function pagesOverflow(){ return [...document.querySelectorAll('#printView .pv-page')].map(pg=>pg.scrollHeight>PAGE_PX+1); }
function openPrintStandings(){
  const pv=$('printView'); pv.style.zoom=1;
  $('printOverlay').hidden=false;
  let layout={mixedOwnPage:false,highlights:true};
  pv.innerHTML=buildStandings(layout);
  let of=pagesOverflow();
  if(of[1]){ layout.mixedOwnPage=true; pv.innerHTML=buildStandings(layout); of=pagesOverflow(); }
  if(of[0]){ layout.highlights=false; pv.innerHTML=buildStandings(layout); }
  $('printOverlay').hidden=false; document.body.style.overflow='hidden';
  fitPrintPreview();
}
function closePrintStandings(){ $('printOverlay').hidden=true; document.body.style.overflow=''; }
function fitPrintPreview(){ const z=Math.min(1,(window.innerWidth-24)/816); $('printView').style.zoom=z; }
window.addEventListener('resize',()=>{ if(!$('printOverlay').hidden) fitPrintPreview(); });
function printStandings(){ window.print(); }
let html2pdfLoading=null;
function loadHtml2pdf(){
  if(window.html2pdf) return Promise.resolve();
  if(!html2pdfLoading) html2pdfLoading=new Promise((res,rej)=>{ const sc=document.createElement('script'); sc.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'; sc.onload=res; sc.onerror=()=>{html2pdfLoading=null;rej(new Error('Could not load the PDF maker'));}; document.head.appendChild(sc); });
  return html2pdfLoading;
}
async function savePdfStandings(btn){
  const label=btn.textContent; btn.textContent='Making PDF…'; btn.disabled=true;
  const el=$('printView'), z=el.style.zoom;
  try{
    await loadHtml2pdf();
    el.style.zoom=1; el.classList.add('pv-capturing');
    await html2pdf().set({margin:0,filename:`Gold-River-Ladder-Standings-${today()}.pdf`,image:{type:'jpeg',quality:0.95},
      html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},jsPDF:{unit:'in',format:'letter',orientation:'portrait'},
      pagebreak:{mode:['css'],before:'.pv-page + .pv-page',avoid:'tr'}}).from(el).save();
    toast('PDF saved');
  }catch(e){ toast('Could not make the PDF — try Print instead'); console.error(e); }
  finally{ el.style.zoom=z; el.classList.remove('pv-capturing'); btn.textContent=label; btn.disabled=false; }
}

// ═══════════════════════════════════════════
//  DISPLAY MODE (Normal = dark, Sun = bright high-contrast)
// ═══════════════════════════════════════════
const ICON_SUN='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/></svg>';
const ICON_MOON='<svg viewBox="0 0 24 24"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>';
function currentTheme(){ return document.documentElement.getAttribute('data-theme')==='sun'?'sun':'normal'; }
function setTheme(mode){
  if(mode==='sun') document.documentElement.setAttribute('data-theme','sun'); else document.documentElement.removeAttribute('data-theme');
  try{ localStorage.setItem('grTheme',mode); }catch(e){}
  const tc=$('themeColor'); if(tc) tc.setAttribute('content',mode==='sun'?'#ffffff':'#1a1f2e');
  syncThemeUI();
}
function toggleTheme(){ setTheme(currentTheme()==='sun'?'normal':'sun'); toast(currentTheme()==='sun'?'☀️ Sun mode on':'🌙 Normal mode'); }
function syncThemeUI(){
  const sun=currentTheme()==='sun';
  const b=$('themeBtn'); if(b){ b.innerHTML=sun?ICON_MOON:ICON_SUN; b.setAttribute('aria-label',sun?'Switch to normal mode':'Switch to sun mode'); }
  document.querySelectorAll('#themeSeg button').forEach(x=>x.classList.toggle('on',x.dataset.mode===(sun?'sun':'normal')));
}
syncThemeUI();

// ═══════════════════════════════════════════
//  MISC
// ═══════════════════════════════════════════
function switchInstall(which,el){ document.querySelectorAll('#installTabs .tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); $('installIOS').hidden=which!=='ios'; $('installAndroid').hidden=which!=='android'; }
let toastTimer;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(10px)'; },2600); }


// ═══════════════════════════════════════════
//  JUNIOR LADDER (only used when JR)
// ═══════════════════════════════════════════
// Parents sign in; jr_families/{parent email}.kids lists the children they manage. The security rules
// read that list, so keep it in step whenever a child's parent emails change.
async function syncFamilies(kidId,before,after){
  if(!JR) return;
  const b=new Set((before||[]).filter(Boolean).map(norm)), a=new Set((after||[]).filter(Boolean).map(norm));
  for(const e of b) if(!a.has(e)) await db.collection('jr_families').doc(e).set({kids:FieldValue.arrayRemove(kidId)},{merge:true});
  for(const e of a) await db.collection('jr_families').doc(e).set({email:e,kids:FieldValue.arrayUnion(kidId)},{merge:true});
}
const jrKidId=name=>'k-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30)+'-'+Math.random().toString(36).slice(2,6);
const ageIn=by=>by?SEASON_YEAR-Number(by):null;
function divOptions(sel){ return JR_DIVISIONS.map(d=>`<option value="${d}"${d===sel?' selected':''}>${LADDERS[d].label}</option>`).join(''); }
function ballOptions(sel){ return BALLS.map(b=>`<option${b===sel?' selected':''}>${b}</option>`).join(''); }
function jrAdminFields(p){
  return `<div class="form-row">
      <div class="form-group"><label class="form-label">Division</label><select id="admDiv">${divOptions(p.division)}</select></div>
      <div class="form-group"><label class="form-label">Ball</label><select id="admBall">${ballOptions(p.ntrp)}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Parent email (login)</label><input type="email" id="admParent" value="${esc(p.parent||'')}"></div>
      <div class="form-group"><label class="form-label">2nd parent email</label><input type="email" id="admParent2" value="${esc(p.parent2||'')}" placeholder="Optional"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Parent name</label><input type="text" id="admParentName" value="${esc(p.parentName||'')}"></div>
      <div class="form-group"><label class="form-label">Parent phone</label><input type="tel" id="admPhone" value="${esc(p.phone||'')}"></div>
    </div>
    <label style="display:flex;gap:8px;align-items:center;font-size:13.5px;margin-bottom:12px"><input type="checkbox" id="admDoubles" style="width:auto" ${p.doubles?'checked':''}> Junior Doubles</label>`;
}
async function jrSavePlayer(id,num){
  const p=getPlayer(id); if(!p) return;
  const parent=norm($('admParent').value), parent2=norm($('admParent2').value);
  if(!isPaper(p)&&!/^\S+@\S+\.\S+$/.test(parent)){ toast('Enter a parent email — it’s their login'); return; }
  try{
    await db.collection(COL('players')).doc(id).update({
      baseSingles:num($('admBaseS').value)??1200, baseDoubles:num($('admBaseD').value)??1200,
      utrSingles:num($('admUtrS').value), utrDoubles:num($('admUtrD').value), billingStart:$('admBilling').value||'',
      division:$('admDiv').value, ntrp:$('admBall').value, doubles:$('admDoubles').checked,
      parent, parent2, email:parent, parentName:$('admParentName').value.trim().slice(0,80), phone:$('admPhone').value.trim().slice(0,30)
    });
    if(!isPaper(p)) await syncFamilies(id,[p.parent,p.parent2],[parent,parent2]);
    toast('Saved'); closeSheet('playerSheet');
  }catch(e){ toast('Could not save: '+e.message); }
}
function jrRenderSignups(){
  const list=state.signups.filter(s=>s.status==='pending').sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  $('signupList').innerHTML=list.length?list.map(s=>{
    const parent=norm(s.email), exists=state.players.some(p=>p.parent===parent&&norm(p.name)===norm(s.name));
    const div=suggestDivision(s.birthYear,s.gender,s.ball), age=ageIn(s.birthYear);
    return `<div class="match-card" style="border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><div style="font-weight:600;font-size:15px">${esc(s.name)}</div><div style="font-size:11px;color:var(--fg2)">${s.createdAt?new Date(s.createdAt.seconds*1000).toLocaleDateString():''}</div></div>
      <div style="font-size:13px;color:var(--fg2);margin-top:2px;line-height:1.55">Born ${esc(s.birthYear||'?')}${age?` (${age} in ${SEASON_YEAR})`:''} · ${s.gender==='F'?'Girl':'Boy'} · ${esc(s.ball||'?')} ball${s.utr?' · UTR '+esc(s.utr):''} · Doubles: ${s.doubles?'yes':'no'}<br>
        Parent: <b style="color:var(--fg)">${esc(s.parentName||'')}</b> · ${esc(s.email)} · ${esc(s.phone||'')}${s.parent2?'<br>2nd parent: '+esc(s.parent2):''}${s.program?'<br>Program: '+esc(s.program):''}${s.avail?'<br>Available: '+esc(s.avail):''}<br>
        Goes into: <b style="color:var(--fg)">${LADDERS[div].label}</b> <span style="font-size:12px">(change any time from their profile)</span></div>
      ${exists?`<div style="font-size:12px;color:var(--gold);margin-top:6px">Already on the ladder — approving will update their record.</div>`:''}
      <div class="match-actions"><button class="btn btn-green btn-sm" onclick="approveSignup('${s.id}')">Approve &amp; add</button><button class="btn btn-secondary btn-sm" onclick="declineSignup('${s.id}')">Decline</button>${s.phone?`<a class="btn btn-secondary btn-sm" href="sms:${esc(s.phone.replace(/\D/g,''))}">Text parent</a>`:''}</div>
    </div>`;
  }).join(''):`<div class="empty"><div class="empty-icon">📬</div><div class="empty-title">No pending sign-ups</div><div class="empty-sub">Parents’ submissions from the junior sign-up page appear here.</div></div>`;
}
async function jrApproveSignup(s){
  const parent=norm(s.email), parent2=norm(s.parent2||'');
  const existing=state.players.find(p=>p.parent===parent&&norm(p.name)===norm(s.name));
  const id=existing?existing.id:jrKidId(s.name);
  const doc={
    name:s.name.trim(), initials:initialsOf(s.name), email:parent, parent, parent2, parentName:(s.parentName||'').trim(), phone:s.phone||'',
    ntrp:s.ball||'', gender:s.gender==='F'?'F':'M', birthYear:s.birthYear||'', division:(existing&&existing.division)||suggestDivision(s.birthYear,s.gender,s.ball),
    doubles:!!s.doubles, program:s.program||'', utrSingles:s.utr?Number(s.utr):(existing?existing.utrSingles??null:null), utrDoubles:existing?existing.utrDoubles??null:null,
    availability:s.avail||(existing&&existing.availability)||'', active:true, billingStart:(existing&&existing.billingStart)||SEASON_START,
    baseSingles:existing?existing.baseSingles??1200:1200, baseDoubles:existing?existing.baseDoubles??1200:1200,
    createdAt:(existing&&existing.createdAt)||FieldValue.serverTimestamp(), approvedBy:state.authEmail
  };
  try{
    await db.collection(COL('players')).doc(id).set(doc,{merge:true});
    await syncFamilies(id,existing?[existing.parent,existing.parent2]:[],[parent,parent2]);
    await db.collection(COL('signups')).doc(s.id).update({status:'approved',approvedAt:FieldValue.serverTimestamp(),playerId:id});
    toast(`${doc.name} added to ${LADDERS[doc.division].label} ✓`);
    setTimeout(()=>openWelcome(id),350);
  }catch(e){ toast('Could not approve: '+e.message); }
}
function jrSuggest(){ const d=suggestDivision($('jrBirth').value,$('jrGender').value,$('jrBall').value); if(d) $('jrDiv').value=d; }
function jrTogglePaper(){ const on=$('jrPaper').checked; $('jrParentLabel').textContent=on?'Parent email (optional)':'Parent email (their login)'; $('jrPaperNote').hidden=!on; }
async function jrAddPlayer(){
  const name=$('jrName').value.trim(), paper=$('jrPaper').checked, parent=norm($('jrParent').value), parent2=norm($('jrParent2').value);
  if(!name){ toast('Enter the player’s name'); return; }
  if(paper){ if(!$('jrPhone').value.trim()){ toast('Add a parent phone so families can call'); return; } }
  else if(!/^\S+@\S+\.\S+$/.test(parent)){ toast('Enter a parent email — it’s their login'); return; }
  if(parent2&&!/^\S+@\S+\.\S+$/.test(parent2)){ toast('The 2nd parent email doesn’t look right'); return; }
  const id=paper?'paper-'+jrKidId(name).slice(2):jrKidId(name);
  const by=$('jrBirth').value.trim(), base=1200;
  const doc={name,initials:initialsOf(name),email:parent,parent:paper?(parent||''):parent,parent2,parentName:$('jrParentName').value.trim(),phone:$('jrPhone').value.trim(),paper,
    ntrp:$('jrBall').value,gender:$('jrGender').value,birthYear:by,division:$('jrDiv').value,doubles:$('jrDoubles').checked,program:'',
    utrSingles:parseFloat($('jrUTRS').value)||null,utrDoubles:parseFloat($('jrUTRD').value)||null,active:true,baseSingles:base,baseDoubles:base,
    billingStart:SEASON_START,availability:'',createdAt:FieldValue.serverTimestamp(),approvedBy:state.authEmail};
  try{
    await db.collection(COL('players')).doc(id).set(doc);
    if(!paper) await syncFamilies(id,[],[parent,parent2]);
    ['jrName','jrParent','jrParent2','jrParentName','jrPhone','jrBirth','jrUTRS','jrUTRD'].forEach(x=>$(x).value='');
    $('jrPaper').checked=false; jrTogglePaper();
    toast(`${name} added to ${LADDERS[doc.division].label} ✓`);
    if(!paper) setTimeout(()=>openWelcome(id),350);
  }catch(e){ toast('Could not add: '+e.message); }
}
function jrWelcomeText(p){
  const first=(p.parentName||'').split(' ')[0]||'there', kid=(p.name||'').split(' ')[0];
  const draws=playerLadders(p).map(t=>LADDERS[t].label).join(' and ');
  return `Hi ${first}, ${kid} is in! Welcome to the Gold River Junior Tennis Ladder${draws?' ('+draws+')':''}.\n\n`+
    `You manage ${kid}'s ladder account from your phone. Getting set up takes 2 minutes:\n\n`+setupSteps(p)+`\n\n`+
    `Once you're in, tap the ? at the top of the app for the full rules and FAQ. Play is free until the season starts ${seasonLabel()}.\n\n— Jordan`;
}
function jrWelcomeEmail(p){
  const first=(p.parentName||'').split(' ')[0]||'there', kid=(p.name||'').split(' ')[0];
  const draws=playerLadders(p).map(t=>LADDERS[t].label);
  const H=t=>`\n\n━━ ${t.toUpperCase()} ━━\n`;
  const days=state.events.filter(e=>e.type==='matchplay'&&(e.date||'')>=today()).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4);
  return `Hi ${first},\n\n`+
  `${kid} is officially on the Gold River Junior Tennis Ladder — welcome! `+
  `${draws.length?`${kid} is entered in ${draws.length===1?draws[0]:draws.slice(0,-1).join(', ')+' and '+draws.slice(-1)}. `:''}`+
  `Parents run the ladder account: you'll set up matches, enter scores and sign ${kid} up for Matchplay Days, all from the ladder app on your phone. Here's how to get set up and how it works.`+
  H('Get set up (2 minutes)')+setupSteps(p)+
  `\n\nIf you have more than one child on the ladder, they're all under your email. Switch between them with the "Playing as" bar at the top of the app.`+
  H('How the ladder works')+
  `• Each division is its own ladder: Orange Ball 10U, Green Ball 12U, and Boys and Girls 14U, 16U and 18U, plus an optional Junior Doubles ladder. Divisions are set by age in ${SEASON_YEAR} and ball color, and Jordan can move a player up or down.\n`+
  `• Everyone starts at 1200 points. Win a match: +${WIN} points. Lose: ${LOSS} points. Rankings are simply who has the most points.`+
  H('Two ways to play')+
  `MATCHPLAY DAYS — Organized match days run by our junior staff. Sign ${kid} up on the Events tab; we pair players by ranking and enter the results, so they count right away.\n\n`+
  `CHALLENGES — Between Matchplay Days, ${kid} can challenge anyone up to 4 spots above them in the same division (anyone in the division during the first ${OPEN_DAYS/7} weeks). You send the challenge from the Play tab and text the other parent to pick a time, then book a court through Club Automation (courts open 48 hours ahead). Challenges are played within ${CHALLENGE_DAYS} days; if it rains, tap 🌧️ Rained out on the challenge to reschedule once or cancel with no penalty.`+
  H('Scores')+
  `• After a challenge match, either parent enters the score on the Play tab.\n`+
  `• The other family gets a Confirm / Dispute prompt on their Home screen. If they don't respond, it counts automatically after ${CONFIRM_HOURS} hours.\n`+
  `• The challenger brings a new can of balls (the right color for the division) and the winner keeps them.`+
  H('Contact and privacy')+
  `Other ladder families see your phone number and email (not ${kid}'s), so you can arrange matches parent to parent. Only parents and guardians sign in. Players don't have their own accounts or messaging. Update your number under Profile.`+
  (days.length?H('Upcoming Matchplay Days')+days.map(e=>`• ${e.title} — ${fmtWhen(e)}`).join('\n'):'')+
  H('Cost')+
  `The junior ladder is free until the season starts ${seasonLabel()}. After that it's $10 a month per player, billed as a house charge on your member account. You can cancel any time by letting me know.`+
  `\n\nAny questions, just reply to this email or find me at the club. See you on the courts!\n\n`+
  `Jordan Boyls\nDirector of Tennis, Gold River Sports Club\njpboyls@gmail.com`;
}
function jrRulesHtml(seasonDay){
  const q=(title,body,open)=>`<details${open?' open':''}><summary>${title}</summary><div class="rules-ans">${body}</div></details>`;
  const sec=(title,items)=>`<div class="rules-sec"><h2>${title}</h2><div class="rules-card">${items.join('')}</div></div>`;
  const days=state.events.filter(e=>e.type==='matchplay'&&(e.date||'')>=today()).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6);
  return `
  <div class="rules-key">
    <div><b>+${WIN} / ${LOSS}</b><span>points for a win / loss</span></div>
    <div><b>${CHALLENGE_DAYS} days</b><span>to play a challenge</span></div>
    <div><b>${CONFIRM_HOURS} hrs</b><span>to confirm a score</span></div>
    <div><b>${DECAY_GRACE} days</b><span>before inactivity slide</span></div>
  </div>
  ${sec('The basics',[
    q('Who can join?',`<p>Junior players at Gold River and the Spare Time clubs, from Orange Ball through 18 and under. A parent or guardian signs up with the junior sign-up form and runs the account. Jordan adds the player and sends the parent a welcome with the app link.</p>`,true),
    q('What are the divisions?',`<p>Each division is its own ladder:</p><ul><li><b>Orange Ball 10U</b> and <b>Green Ball 12U</b> (boys and girls together)</li><li><b>Boys</b> and <b>Girls 14U, 16U and 18U</b> (yellow ball)</li><li><b>Junior Doubles</b>, open to any player who opts in, with any partner</li></ul><p>Players are placed by their age in ${SEASON_YEAR} and the ball color they play with. Jordan can move a player up or down when that's a better fit.</p>`),
    q('How are rankings decided?',`<p>Everyone starts at <b>1200 points</b> in their division. Rankings are simply who has the most points.</p><ul><li>Win a match: <b>+${WIN} points</b></li><li>Lose a match: <b>${LOSS} points</b></li></ul><p>Jordan may adjust a starting point if a player is clearly placed too high or low.</p>`),
    q('Why do parents sign in instead of players?',`<p>Only parents and guardians have accounts. Players don't sign in, post or message anyone. Other families see the parent's phone and email, so every match is arranged parent to parent. One login covers all your children: switch between them with the <b>Playing as</b> bar at the top of the app.</p>`),
    q('Can we play without the app?',`<p>Yes. Tell Jordan when you sign up and your child is added as a 📞 paper player. Other families will call or text you to set up matches, and the standings are posted on the junior bulletin board. Turn in a <b>Match Score Card</b> from the front desk after each match.</p>`),
  ])}
  ${sec('Matchplay Days',[
    q('What is a Matchplay Day?',`<p>An organized day of ladder matches run by our junior staff. Sign up on the <b>Events</b> tab. We pair players by ranking in each division and enter the results, so they count right away. No scheduling or score entry needed from parents.</p>`),
    q('When are they?',days.length?`<p>${days.map(e=>`<b>${esc(e.title)}</b> — ${esc(fmtWhen(e))}`).join('<br>')}</p><p>Details and sign-up are on the <b>Events</b> tab.</p>`:`<p>Dates will be posted on the <b>Events</b> tab.</p>`),
  ])}
  ${sec('Challenges & matches',[
    q('Who can my child challenge?',`<p>Anyone up to <b>4 spots above them</b> in the same division. The Play tab only lists the players they’re allowed to challenge. New players can challenge <b>anyone in their division</b> for their first ${OPEN_DAYS/7} weeks, and so can everyone during the free pre-season.</p>`),
    q('How do we set up a challenge match?',`<p>Send the challenge from the <b>Play</b> tab, then text the other parent (the <b>Text parent</b> button) to pick a time. Book a court through Club Automation, which opens <b>48 hours in advance</b>. The match has to be played within <b>${CHALLENGE_DAYS} days</b>.</p>`),
    q('What if we get rained out?',`<p>Tap <b>🌧️ Rained out</b> on the accepted challenge. Either family can <b>reschedule</b> once, which adds ${RAIN_DAYS} days, or <b>cancel</b> with no penalty and no effect on the rankings.</p>`),
    q('What’s the match format?',`<p>Unless Jordan sets a shorter format for a division, best of 3 sets with a 10-point tiebreak in place of a third set. Matchplay Day formats are posted with each event.</p>`),
    q('Who brings the balls?',`<p><b>The challenger brings a new can</b> in the right ball color for the division, and the winner keeps them. In doubles, the challenging team brings the can.</p>`),
    q('How do we record a score?',`<p>Either parent goes to <b>Play → Submit Match Score</b>. The other family confirms it on their Home screen; if they don’t respond within <b>${CONFIRM_HOURS} hours</b>, it counts automatically. If a score is wrong, tap <b>Dispute</b> and Jordan will sort it out.</p>`),
  ])}
  ${sec('Staying active',[
    q('What happens if my child doesn’t play for a while?',`<p>Starting <b>${seasonDay}</b>, after <b>${DECAY_GRACE} days</b> without a confirmed match a player loses <b>${DECAY_POINTS} points a week</b> until they play again (at most ${DECAY_CAP} points per idle stretch). Matchplay Days count. The app gives you a heads-up 10 days ahead.</p>`),
    q('Injured, busy with school, or away?',`<p>Let Jordan know. He can mark your child inactive so they don’t lose points, and bring them back when they’re ready.</p>`),
  ])}
  ${sec('Fees',[
    q('How much does it cost?',`<p>Free until <b>${seasonDay}</b>, when the season starts. After that it’s <b>$10 a month per player</b>, billed as a house charge on the parent’s member account.</p>`),
    q('How do we cancel?',`<p>Let Jordan know. Billing stops at the end of that month.</p>`),
  ])}
  ${sec('Using the app',[
    q('How do I sign in?',`<p>Enter the parent email you signed up with and tap <b>Email me a sign-in link</b>. On iPhone, if you opened the app from your home screen, press and hold the link in the email, choose <b>Copy Link</b>, and paste it into the box on the sign-in screen. You stay signed in after that.</p>`),
    q('I have more than one child on the ladder',`<p>They’re all under your email. Use the <b>Playing as</b> bar at the top to switch between them; challenges, scores and sign-ups apply to whoever is selected.</p>`),
    q('Who do I contact with questions?',`<p>Jordan Boyls, Director of Tennis — <span style="user-select:all;color:var(--accent-hi);font-weight:600">jpboyls@gmail.com</span></p>`),
  ])}`;
}
