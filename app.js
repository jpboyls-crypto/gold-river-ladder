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
  email: null,         // lowercased
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
  if(!user){ state.user=null; state.email=null; state.isAdmin=false; stopListeners(); showAuth('authLogin'); return; }
  state.user = user; state.email = norm(user.email); state.isAdmin = ADMIN_EMAILS.includes(state.email);
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
  unsubs.push(db.collection('players').onSnapshot(s=>{ state.players=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.players=true; afterData(); }, onErr('players')));
  unsubs.push(db.collection('matches').orderBy('date','desc').onSnapshot(s=>{ state.matches=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.matches=true; afterData(); }, onErr('matches')));
  unsubs.push(db.collection('challenges').onSnapshot(s=>{ state.challenges=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.challenges=true; afterData(); }, onErr('challenges')));
  unsubs.push(db.collection('events').onSnapshot(s=>{ state.events=s.docs.map(d=>({id:d.id,...d.data()})); if(booted) rerender(); }, e=>{ console.warn('events unavailable', e); }));
  unsubs.push(db.collection('hits').onSnapshot(s=>{ state.hits=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.hits=true; afterData(); }, onErr('hits')));
  if(state.isAdmin){
    unsubs.push(db.collection('signups').onSnapshot(s=>{ state.signups=s.docs.map(d=>({id:d.id,...d.data()})); renderSignupBadge(); if(currentPage==='Admin') renderAdmin(); }, onErr('signups')));
  }
}
let booted=false, currentPage='Home';
function onNotMember(){ stopListeners(); showAuth('authNotMember'); $('notMemberText').innerHTML = `<b>${esc(state.email)}</b> isn’t on the member list yet. If you just signed up, Jordan will add you shortly and text or email you when you’re in. Otherwise sign up first, or check with Jordan.`; }
function afterData(){
  if(!Object.values(state.ready).every(Boolean)) return;
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
function getPlayer(id){ return state.players.find(p=>p.id===id) }
function me(){ return getPlayer(state.email) }
function displayName(id){ const p=getPlayer(id); return p?p.name:(id||'Unknown'); }

const LADDERS={
  ms:{label:"Men's Singles",  short:"M Singles", flag:'singles',base:'baseSingles',utr:'utrSingles',gender:'M',color:'var(--accent-hi)',chip:'chip-blue'},
  ws:{label:"Women's Singles",short:"W Singles", flag:'singles',base:'baseSingles',utr:'utrSingles',gender:'F',color:'var(--accent-hi)',chip:'chip-blue'},
  md:{label:"Men's Doubles",  short:"M Doubles", flag:'doubles',base:'baseDoubles',utr:'utrDoubles',gender:'M',color:'var(--green)',chip:'chip-green'},
  wd:{label:"Women's Doubles",short:"W Doubles", flag:'doubles',base:'baseDoubles',utr:'utrDoubles',gender:'F',color:'var(--green)',chip:'chip-green'},
  mx:{label:'Mixed Doubles',  short:'Mixed',     flag:'mixed',  base:'baseMixed',  utr:'utrDoubles',gender:null,color:'var(--purple)',chip:'chip-purple'},
};
const LADDER_ORDER=['ms','ws','md','wd','mx'];
function isDoubles(t){ return t==='md'||t==='wd'||t==='mx' }
function ladderLabel(t){ return LADDERS[t]?LADDERS[t].label:t }
function ladderColor(t){ return LADDERS[t].color }
function playedIn(x,id){ return x.p1===id||x.p2===id||x.p1Partner===id||x.p2Partner===id }
function wonBy(x,id){ const side1=id===x.p1||id===x.p1Partner; return side1?x.winner===x.p1:x.winner===x.p2; }
function getUTR(p,t){ return p[LADDERS[t].utr] }
// ── dates ──
function tsMs(ts){ if(!ts) return Date.now(); if(typeof ts.seconds==='number') return ts.seconds*1000; const d=new Date(ts); return isNaN(d)?Date.now():d.getTime(); }
function dayMs(d){ const [y,m,dd]=(d||'').split('-').map(Number); return new Date(y,(m||1)-1,dd||1).getTime(); }
function fmtShort(ms){ return new Date(ms).toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function seasonStarted(){ return Date.now()>=dayMs(SEASON_START); }

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
function activityFor(m,id){ return counts(m)&&playedIn(m,id)&&!(m.forfeit&&!wonBy(m,id)); }
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
  pts.sort((a,b)=>a-b); pts.push(Date.now());
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
  for(const m of state.matches){ if(m.ladder!==t||!playedIn(m,p.id)||!counts(m)) continue; r += wonBy(m,p.id)?WIN:LOSS; }
  return r-decayPenalty(p);
}
function record(p){ let w=0,l=0; for(const m of state.matches){ if(!playedIn(m,p.id)||!counts(m)) continue; wonBy(m,p.id)?w++:l++; } return {w,l}; }
function playerLadders(p){ return LADDER_ORDER.filter(t=>{const L=LADDERS[t];return p[L.flag]&&(!L.gender||p.gender===L.gender)}); }
function getRanked(t){
  const L=LADDERS[t];
  return state.players.filter(p=>p.active!==false&&p[L.flag]&&(!L.gender||p.gender===L.gender))
    .map(p=>({p,r:getRating(p,t)})).sort((a,b)=>b.r-a.r||a.p.name.localeCompare(b.p.name)).map(x=>x.p);
}
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
  const m=me();
  if(!m){ // admin without a player record
    $('heroName').textContent='Admin'; $('heroRank').textContent='You’re signed in as the ladder admin.';
    $('heroWins').textContent=state.players.length; $('heroLosses').textContent=state.matches.length;
    $('heroRating').textContent='—'; $('heroPending').textContent=state.signups.filter(s=>s.status==='pending').length;
    $('pendingList').innerHTML=`<div class="empty"><div class="empty-title">Manage the ladder from the Admin tab</div><div class="empty-sub">Add yourself as a player there if you want to compete too.</div></div>`;
    $('recentList').innerHTML=recentMatchesHtml(state.matches.slice(0,5),null);
    return;
  }
  const rec=record(m);
  $('heroName').textContent=m.name;
  const parts=playerLadders(m).map(t=>`#${rankIn(m,t)} ${LADDERS[t].short}`);
  $('heroRank').textContent=parts.join(' · ')||'Not enrolled in any ladder';
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
        <div style="margin-top:8px">${c.status==='accepted'&&!isExpired(c)?'<span class="chip chip-green">Accepted</span> ':''}${clockLabel(c)}</div>
        ${isExpired(c)?'':incoming&&c.status==='pending'?`<div class="match-actions">
          <button class="btn btn-green btn-sm" onclick="respondChallenge('${c.id}','accepted')">Accept</button>
          <button class="btn btn-secondary btn-sm" onclick="respondChallenge('${c.id}','declined')">Decline</button>
          ${other&&other.phone?`<a class="btn btn-secondary btn-sm" href="sms:${esc(other.phone.replace(/\\D/g,''))}">Text</a>`:''}
        </div>`:`<div class="match-actions">${c.status==='accepted'?bookBtn(c.date):''}${c.from===m.id?`<button class="btn btn-secondary btn-sm" onclick="cancelChallenge('${c.id}')">Withdraw</button>`:''}${other&&other.phone?`<a class="btn btn-secondary btn-sm" href="sms:${esc(other.phone.replace(/\\D/g,''))}">Text ${esc(other.name.split(' ')[0])}</a>`:''}</div>`}
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
        <div style="display:flex;margin-right:2px"><div class="avatar" style="width:30px;height:30px;font-size:11px">${esc(a.initials)}</div><div class="avatar" style="width:30px;height:30px;font-size:11px;margin-left:-8px;box-shadow:0 0 0 2px var(--surface)">${esc(b.initials)}</div></div>
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
        <div class="rank-meta">${isNewMember(p)&&seasonStarted()?'<span class="chip chip-green" style="padding:1px 6px;font-size:10px">NEW</span> ':''}${decayPenalty(p)?`<span class="chip chip-red" style="padding:1px 6px;font-size:10px">\u2212${decayPenalty(p)} idle</span> `:''}NTRP ${esc(p.ntrp)} · ${rec.w}W ${rec.l}L${showUTR&&utr?` · <span class="utr-badge" style="vertical-align:middle"><span class="utr-label">UTR</span>${Number(utr).toFixed(2)}</span>`:''}</div></div>
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
      <div style="font-size:10px;color:var(--fg2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Contact</div>
      ${p.phone?`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px"><span style="user-select:all">${esc(p.phone)}</span><span style="display:flex;gap:6px"><a class="btn btn-secondary btn-sm" href="sms:${digits}">Text</a><a class="btn btn-secondary btn-sm" href="tel:${digits}">Call</a></span></div>`:''}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="user-select:all;font-size:13px;overflow:hidden;text-overflow:ellipsis">${esc(p.email)}</span><a class="btn btn-secondary btn-sm" href="mailto:${esc(p.email)}">Email</a></div>
      ${p.availability?`<div style="font-size:12.5px;color:var(--fg2);margin-top:8px">Usually free: ${esc(p.availability)}</div>`:''}
    </div>`:'';
  $('sheetBody').innerHTML=`
    <div style="text-align:center;margin-bottom:16px">
      <div class="avatar" style="width:60px;height:60px;font-size:24px;margin:0 auto 8px">${esc(p.initials)}</div>
      <div style="font-size:13px;color:var(--fg2)">NTRP ${esc(p.ntrp)} · ${p.membership==='full'?'Full Member':'Tennis Member'}${p.active===false?' · <span class="chip chip-red">Inactive</span>':''}</div>
      ${utrParts.length?`<div style="margin-top:8px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap">${utrParts.join('')}</div>`:''}
    </div>
    ${ratingBlocks.length?`<div style="display:grid;grid-template-columns:repeat(${Math.min(3,ratingBlocks.length)},1fr);gap:8px;margin-bottom:16px">${ratingBlocks.join('')}</div>`:''}
    ${contact}
    ${!isMe&&m?`<button class="btn btn-primary btn-full" style="margin-bottom:16px" onclick="closeSheet('playerSheet');goPage('Challenge',$('navChallenge'))">Challenge ${esc(p.name.split(' ')[0])}</button>`:''}
    ${pMatches.length?`<div class="section-head" style="padding-top:0">Recent Matches</div><div class="card">${pMatches.map(match=>{const won=wonBy(match,id);
      return `<div class="match-card" style="border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;justify-content:space-between"><div><div style="font-weight:600;font-size:14px">${matchLine(match,id)}</div><div style="font-size:12px;color:var(--fg2)">${esc(ladderLabel(match.ladder))} · ${esc(match.date)}</div></div><span class="score-pill ${won?'w':'l'}">${won?'W':'L'} ${esc(match.score)}</span></div></div>`;}).join('')}</div>`:''}
    ${state.isAdmin?`<div class="divider"></div>
      <div class="section-head" style="padding-top:0">Admin</div>
      <div class="card" style="padding:14px">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Base S</label><input type="number" id="admBaseS" value="${p.baseSingles??NTRP_BASE[p.ntrp]??1200}"></div>
          <div class="form-group"><label class="form-label">Base D</label><input type="number" id="admBaseD" value="${p.baseDoubles??NTRP_BASE[p.ntrp]??1200}"></div>
          <div class="form-group"><label class="form-label">Base MX</label><input type="number" id="admBaseM" value="${p.baseMixed??NTRP_BASE[p.ntrp]??1200}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">UTR S</label><input type="number" step="0.01" id="admUtrS" value="${p.utrSingles??''}"></div>
          <div class="form-group"><label class="form-label">UTR D</label><input type="number" step="0.01" id="admUtrD" value="${p.utrDoubles??''}"></div>
          <div class="form-group"><label class="form-label">Billing starts</label><input type="date" id="admBilling" value="${esc(p.billingStart||'')}"></div>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px;margin-bottom:12px">
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="admSingles" ${p.singles?'checked':''}>Singles</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="admDoubles" ${p.doubles?'checked':''}>Doubles</label>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="admMixed" ${p.mixed?'checked':''}>Mixed</label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="adminSavePlayer('${esc(id)}')">Save</button>
          <button class="btn ${p.active===false?'btn-green':'btn-danger'} btn-sm" onclick="adminToggleActive('${esc(id)}',${p.active===false})">${p.active===false?'Reactivate':'Mark Inactive'}</button>
          <button class="btn btn-secondary btn-sm" onclick="openWelcome('${esc(id)}')">Send welcome</button>
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
  const challengeable=open?ranked.filter(p=>p.id!==state.email):(myRank>0?ranked.filter((p,i)=>i<myRank).slice(-4):[]);
  const note=$('chlNote');
  if(note&&selectId==='chlOpponent') note.innerHTML=open
    ?`<div style="font-size:12.5px;line-height:1.5;padding:10px 12px;border-radius:8px;background:rgba(58,170,106,.12);color:var(--fg);margin-bottom:14px">🟢 <b>Open challenges until ${fmtShort(openUntilMs(m))}.</b> ${seasonStarted()?'As a new member':'During the pre-season and the first 3 weeks of the season'} you can challenge anyone in your draw. After that it\u2019s up to 4 spots above you.</div>`
    :`<div style="font-size:12.5px;color:var(--fg2);margin-bottom:14px">You can challenge anyone up to 4 spots above you. They have ${CHALLENGE_DAYS} days to play.</div>`;
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
function challengeDeadline(c){ return tsMs(c.createdAt)+CHALLENGE_DAYS*DAY; }
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
    await db.collection('challenges').add({from:state.email,to,ladder,date:$('chlDate').value,message:$('chlMessage').value.trim().slice(0,300),status:'pending',createdAt:FieldValue.serverTimestamp()});
    $('chlMessage').value=''; toast(`Challenge sent! Play by ${fmtShort(Date.now()+CHALLENGE_DAYS*DAY)} 🎾`);
  }catch(e){ toast('Could not send: '+e.message); }
}
async function confirmMatch(id,ok){
  try{
    await db.collection('matches').doc(id).update({status:ok?'confirmed':'disputed',confirmedBy:state.email,confirmedAt:FieldValue.serverTimestamp()});
    toast(ok?'Confirmed \u2014 rankings updated ✓':'Disputed \u2014 Jordan will sort it out');
  }catch(e){ toast('Could not update: '+e.message); }
}
async function respondChallenge(cid,status){
  try{ await db.collection('challenges').doc(cid).update({status,respondedAt:FieldValue.serverTimestamp()}); toast(status==='accepted'?'Challenge accepted! Set up a time by text.':'Challenge declined.'); }
  catch(e){ toast('Could not update: '+e.message); }
}
async function cancelChallenge(cid){
  try{ await db.collection('challenges').doc(cid).delete(); toast('Challenge withdrawn'); }catch(e){ toast('Could not withdraw: '+e.message); }
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
    await db.collection('matches').add({p1:state.email,p1Partner,p2:opp,p2Partner,ladder,score:score.slice(0,40),winner,date,submittedBy:state.email,status:'pending',createdAt:FieldValue.serverTimestamp()});
    // auto-close any pending challenge between these two in this draw
    state.challenges.filter(c=>isOpenChallenge(c)&&c.ladder===ladder&&((c.from===state.email&&c.to===opp)||(c.from===opp&&c.to===state.email)))
      .forEach(c=>db.collection('challenges').doc(c.id).update({status:'played'}).catch(()=>{}));
    $('scoreInput').value=''; toast(`Score sent \u2014 it counts once ${displayName(opp).split(' ')[0]} confirms (or automatically in ${CONFIRM_HOURS} hours)`);
  }catch(e){ toast('Could not submit: '+e.message); }
}

// ═══════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════
function renderProfile(){
  const m=me();
  $('profEmail').textContent=state.email;
  if(!m){ $('profileAvatar').textContent='A'; $('profileName').textContent='Ladder Admin'; $('profileMember').textContent=state.email; $('profileChips').innerHTML=''; $('profRanks').innerHTML=''; $('profUTRRow').innerHTML=''; ['profW','profL','profM','profPct'].forEach(id=>$(id).textContent='—'); $('historyList').innerHTML=`<div class="empty"><div class="empty-title">No player record</div><div class="empty-sub">Add yourself from the Admin tab to compete.</div></div>`; return; }
  const mine=playerLadders(m), rec=record(m);
  $('profileAvatar').textContent=m.initials; $('profileName').textContent=m.name;
  $('profileMember').textContent=(m.membership==='full'?'Full Member':'Tennis Member')+' — Gold River SC';
  $('profileChips').innerHTML=mine.map(t=>`<span class="chip ${LADDERS[t].chip}">${LADDERS[t].short} #${rankIn(m,t)}</span>`).join('');
  const rankItems=mine.map(t=>`<div style="text-align:center"><div style="font-size:10px;color:var(--fg2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">${LADDERS[t].short}</div>
    <div style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;color:${LADDERS[t].color}">#${rankIn(m,t)}</div><div style="font-size:12px;color:var(--fg2)">${getRating(m,t)} pts</div></div>`);
  const g=$('profRanks'); g.style.gridTemplateColumns=`repeat(${Math.min(3,Math.max(1,rankItems.length))},1fr)`; g.innerHTML=rankItems.join('');
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
  try{ await db.collection('players').doc(state.email).update({phone:$('profPhone').value.trim().slice(0,30),availability:$('profAvail').value.trim().slice(0,120)}); toast('Saved'); }
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
    await db.collection('hits').add({by:state.email,format:$('hitFormat').value,range:parseFloat($('hitRange').value),days,times,note:$('hitNote').value.trim().slice(0,200),posted:today(),responses:[],closed:false,createdAt:FieldValue.serverTimestamp()});
    document.querySelectorAll('.day-picker span.on').forEach(s=>s.classList.remove('on')); $('hitNote').value='';
    toast('Posted — members near your level will see it 🎾');
    switchHit('mine',document.querySelectorAll('#hitTabs .tab')[2]);
  }catch(e){ toast('Could not post: '+e.message); }
}
async function toggleInterest(id){
  const h=state.hits.find(x=>x.id===id); if(!h) return;
  const replied=(h.responses||[]).includes(state.email);
  try{ await db.collection('hits').doc(id).update({responses:replied?FieldValue.arrayRemove(state.email):FieldValue.arrayUnion(state.email)}); toast(replied?'Removed your interest':`${displayName(h.by).split(' ')[0]} will see you’re in 🎾`); }
  catch(e){ toast('Could not update: '+e.message); }
}
async function closeHit(id){ try{ await db.collection('hits').doc(id).update({closed:true}); toast('Request closed'); }catch(e){ toast('Could not close: '+e.message); } }

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
  const email=norm(s.email); const draws=s.draws||[];
  const ntrp=String(s.ntrp||'3.5').replace('+','');
  const existing=getPlayer(email)||{};
  const doc={
    name:s.name.trim(), initials:initialsOf(s.name), email, phone:s.phone||'', ntrp:NTRP_BASE[ntrp]?ntrp:'3.5',
    gender:(s.placement||'').startsWith('Women')?'F':'M', membership:existing.membership||'full',
    singles:draws.includes('Singles'), doubles:draws.includes('Doubles'), mixed:draws.includes('Mixed Doubles'),
    utrSingles:s.utr?Number(s.utr):(existing.utrSingles??null), utrDoubles:existing.utrDoubles??null,
    availability:s.avail||existing.availability||'', active:true, billingStart:existing.billingStart||'2027-01-01',
    baseSingles:existing.baseSingles??NTRP_BASE[ntrp]??1200, baseDoubles:existing.baseDoubles??NTRP_BASE[ntrp]??1200, baseMixed:existing.baseMixed??NTRP_BASE[ntrp]??1200,
    createdAt:existing.createdAt||FieldValue.serverTimestamp(), approvedBy:state.email
  };
  try{
    await db.collection('players').doc(email).set(doc,{merge:true});
    await db.collection('signups').doc(id).update({status:'approved',approvedAt:FieldValue.serverTimestamp()});
    toast(`${doc.name} added to the ladder ✓`);
    setTimeout(()=>openWelcome(email),350);
  }catch(e){ toast('Could not approve: '+e.message); }
}
async function declineSignup(id){ try{ await db.collection('signups').doc(id).update({status:'declined'}); toast('Declined'); }catch(e){ toast('Could not update: '+e.message); } }
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
          <div style="font-size:12px;color:var(--fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">NTRP ${esc(p.ntrp)} \u00b7 ${p.gender==='F'?"Women's":"Men's"} \u00b7 ${esc(p.email)}</div>
        </div>
        <span class="chip ${p.active!==false?'chip-green':'chip-red'}">${p.active!==false?'Active':'Inactive'}</span>
        <span style="color:var(--fg2);font-size:20px;line-height:1">\u203a</span>
      </div>
      <div class="pcard-stats">${draws||'<span class="pstat">No draws</span>'}${utr}<span class="pstat">${rec.w}W\u2013${rec.l}L</span><span class="pstat">Billing <b>${esc(p.billingStart||'\u2014')}</b></span></div>
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
      `</div><div class="section-head" style="padding-top:0">All matches</div>`;
  }
  renderMatchBadge();
  $('adminMatchList').innerHTML=att+'<div class="card">'+(state.matches.length?state.matches.map(m=>{const st=matchState(m);return `<div class="match-card" style="border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="min-width:0"><div style="font-weight:600;font-size:14px">${esc(displayName(m.p1))}${m.p1Partner?' &amp; '+esc(displayName(m.p1Partner)):''} vs ${esc(displayName(m.p2))}${m.p2Partner?' &amp; '+esc(displayName(m.p2Partner)):''}</div>
      <div style="font-size:12px;color:var(--fg2)">${esc(ladderLabel(m.ladder))} · ${esc(m.date)} · W: ${esc(displayName(m.winner))} · by ${esc(displayName(m.submittedBy))}</div><div style="font-size:13px;margin-top:2px">${esc(m.score)} ${st==='confirmed'?'':'<span class="chip '+(st==='disputed'?'chip-red">Disputed':'chip-gold">Pending')+'</span>'}</div></div>
      <button class="btn btn-danger btn-sm" onclick="deleteMatch('${m.id}')">Del</button></div></div>`;}).join('')
    :`<div class="empty"><div class="empty-title">No matches recorded</div></div>`)+'</div>';
}
async function adminResolveMatch(id){ try{ await db.collection('matches').doc(id).update({status:'confirmed',resolvedBy:state.email}); toast('Counted \u2014 rankings updated'); }catch(e){ toast('Could not update: '+e.message); } }
async function awardForfeit(cid){
  const c=state.challenges.find(x=>x.id===cid); if(!c) return;
  try{
    await db.collection('matches').add({p1:c.from,p1Partner:null,p2:c.to,p2Partner:null,ladder:c.ladder,score:'Forfeit',winner:c.from,date:today(),submittedBy:state.email,status:'confirmed',forfeit:true,createdAt:FieldValue.serverTimestamp()});
    await db.collection('challenges').doc(cid).update({status:'forfeited'});
    toast(`Forfeit win recorded for ${displayName(c.from).split(' ')[0]}`);
  }catch(e){ toast('Could not record: '+e.message); }
}
async function voidChallenge(cid){ try{ await db.collection('challenges').doc(cid).update({status:'void'}); toast('Challenge voided'); }catch(e){ toast('Could not update: '+e.message); } }
let pendingDelete=null;
async function deleteMatch(id){
  if(pendingDelete!==id){ pendingDelete=id; toast('Tap Del again to confirm'); setTimeout(()=>{ if(pendingDelete===id) pendingDelete=null; },4000); return; }
  pendingDelete=null;
  try{ await db.collection('matches').doc(id).delete(); toast('Match deleted — ratings recalculated'); }catch(e){ toast('Could not delete: '+e.message); }
}
async function addPlayer(){
  const name=$('addName').value.trim(), email=norm($('addEmail').value);
  if(!name){ toast('Please enter a name'); return; }
  if(!/^\S+@\S+\.\S+$/.test(email)){ toast('Please enter a valid email — it’s their login'); return; }
  const ntrp=$('addNTRP').value, base=NTRP_BASE[ntrp]||1200;
  const singles=$('addSingles').checked, doubles=$('addDoubles').checked, mixed=$('addMixed').checked;
  if(!singles&&!doubles&&!mixed){ toast('Enroll in at least one ladder'); return; }
  if(getPlayer(email)){ toast('That email is already on the ladder'); return; }
  try{
    await db.collection('players').doc(email).set({
      name,initials:initialsOf(name),email,phone:$('addPhone').value.trim(),ntrp,gender:$('addGender').value,membership:$('addMembership').value,
      utrSingles:parseFloat($('addUTRS').value)||null,utrDoubles:parseFloat($('addUTRD').value)||null,
      singles,doubles,mixed,active:true,baseSingles:base,baseDoubles:base,baseMixed:base,billingStart:'2027-01-01',availability:'',createdAt:FieldValue.serverTimestamp(),approvedBy:state.email
    });
    ['addName','addEmail','addPhone','addUTRS','addUTRD'].forEach(id=>$(id).value='');
    toast(`${name} added to the ladder ✓`);
    setTimeout(()=>openWelcome(email),350);
  }catch(e){ toast('Could not add: '+e.message); }
}
async function adminSavePlayer(id){
  const num=v=>{ const n=parseFloat(v); return isNaN(n)?null:n; };
  try{
    await db.collection('players').doc(id).update({
      baseSingles:num($('admBaseS').value)??1200, baseDoubles:num($('admBaseD').value)??1200, baseMixed:num($('admBaseM').value)??1200,
      utrSingles:num($('admUtrS').value), utrDoubles:num($('admUtrD').value), billingStart:$('admBilling').value||'',
      singles:$('admSingles').checked, doubles:$('admDoubles').checked, mixed:$('admMixed').checked
    });
    toast('Saved'); closeSheet('playerSheet');
  }catch(e){ toast('Could not save: '+e.message); }
}
// ── welcome message (sent from the admin's own phone; no email service needed) ──
const APP_URL='https://jpboyls-crypto.github.io/gold-river-ladder/';
// Setup steps shared by the text and the email.
function setupSteps(p){
  return `1) Open this link on your phone — in Safari on iPhone, Chrome on Android:\n${APP_URL}\n\n`+
    `2) Add it to your home screen first.\n   iPhone: tap the Share button (square with the up arrow) → Add to Home Screen → Add.\n   Android: tap the ⋮ menu → Add to Home screen (or Install app).\n\n`+
    `3) Open the new GR Ladder icon, enter ${p.email} and tap "Email me a sign-in link."\n\n`+
    `4) In that email, don't tap the link — press and hold it, choose Copy Link, then go back to the ladder app, paste it in the box and tap Sign in. (Check spam the first time.)\n\n`+
    `That's it — you'll stay signed in after that.`;
}
function seasonLabel(){ return new Date(SEASON_START+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); }
// Short version for a text message.
function welcomeText(p){
  const first=(p.name||'').split(' ')[0]||'there';
  const draws=playerLadders(p).map(t=>LADDERS[t].label).join(', ');
  return `Hi ${first}, you're in! Welcome to the Gold River Tennis Ladder${draws?' ('+draws+')':''}.\n\n`+
    `Getting set up takes 2 minutes:\n\n`+setupSteps(p)+`\n\n`+
    `Once you're in, tap the ? at the top of the app for the full rules and FAQ. Play is free until the season starts ${seasonLabel()}.\n\n— Jordan`;
}
// Full version for email: setup + a tour of everything the app does.
function welcomeEmail(p){
  const first=(p.name||'').split(' ')[0]||'there';
  const draws=playerLadders(p).map(t=>LADDERS[t].label);
  const pts=getRating(p,playerLadders(p)[0]||'ms');
  const H=t=>`\n\n━━ ${t.toUpperCase()} ━━\n`;
  const tourneys=state.events.filter(e=>e.type==='tournament'&&(e.date||'')>=today()).sort((a,b)=>a.date.localeCompare(b.date));
  return `Hi ${first},\n\n`+
  `You're officially on the Gold River Tennis Ladder — welcome! `+
  `${draws.length?`You're entered in ${draws.length===1?'the '+draws[0]+' draw':draws.slice(0,-1).join(', ')+' and '+draws.slice(-1)+' draws'}. `:''}`+
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
  `EVENTS — Quarterly ladder tournaments, socials and other ladder events. Tap Enter or I'm going to sign up, and add events to your Apple or Google calendar.\n\n`+
  `PROFILE — Add your phone number and when you usually like to play, so other members can reach you. Your full match history is here too.\n\n`+
  `? BUTTON (top right) — The complete rules and FAQ, any time.`+
  H('Challenges')+
  `• You can challenge anyone up to 4 spots above you in the same draw. New members can challenge anyone in their draw for their first ${OPEN_DAYS/7} weeks — and right now, during the free pre-season, everyone can.\n`+
  `• Once a challenge is sent you have ${CHALLENGE_DAYS} days to play it. Text each other to pick a time, then book a court.\n`+
  `• Matches are best of 3 sets, with a 10-point tiebreak in place of a third set.`+
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
  `Jordan Boyls\nDirector of Tennis, Gold River Sports Club\nJordanB@sparetimesportsclubs.com`;
}
function smsHref(phone,body){ const n=(phone||'').replace(/\D/g,''); const ios=/iPad|iPhone|iPod/.test(navigator.userAgent); return `sms:${n}${ios?'&':'?'}body=${encodeURIComponent(body)}`; }
function openWelcome(id){
  const p=getPlayer(id); if(!p) return;
  const sms=welcomeText(p), mail=welcomeEmail(p);
  const subj=encodeURIComponent('Welcome to the Gold River Tennis Ladder');
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
let pendingPlayerDelete=null;
async function adminDeletePlayer(id){
  if(pendingPlayerDelete!==id){ pendingPlayerDelete=id; toast('Tap Delete again to confirm'); setTimeout(()=>{ if(pendingPlayerDelete===id) pendingPlayerDelete=null; },4000); return; }
  pendingPlayerDelete=null;
  try{ await db.collection('players').doc(id).delete(); toast('Player deleted'); closeSheet('playerSheet'); }catch(e){ toast('Could not delete: '+e.message); }
}
// Marking inactive starts a "hold"; reactivating closes it. Days on hold never count toward inactivity decay.
async function adminToggleActive(id,makeActive){
  const p=getPlayer(id); if(!p) return;
  const upd = makeActive
    ? {active:true, inactiveSince:null, holds:FieldValue.arrayUnion({from:p.inactiveSince||today(), to:today()})}
    : {active:false, inactiveSince:today()};
  try{ await db.collection('players').doc(id).update(upd); toast(makeActive?'Reactivated \u2014 no points lost for the time away':'Marked inactive \u2014 off the ladder, no decay while away'); closeSheet('playerSheet'); }catch(e){ toast('Could not update: '+e.message); }
}


// ═══════════════════════════════════════════
//  EVENTS (quarterly tournaments, socials, etc.)
// ═══════════════════════════════════════════
const EVENT_TYPES={
  tournament:{label:'Ladder Tournament',icon:'🏆',color:'var(--gold)',bg:'rgba(232,184,75,.15)',join:'Enter',joined:'Entered \u2713',who:'entered'},
  social:{label:'Social',icon:'🎉',color:'var(--purple)',bg:'rgba(155,114,240,.15)',join:"I'm going",joined:'Going \u2713',who:'going'},
  clinic:{label:'Clinic / Drill',icon:'🎾',color:'var(--green)',bg:'rgba(58,170,106,.15)',join:"I'm in",joined:'In \u2713',who:'in'},
  other:{label:'Other',icon:'📌',color:'var(--accent-hi)',bg:'rgba(45,107,228,.15)',join:"I'm going",joined:'Going \u2713',who:'going'}
};
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
    :`<div class="empty"><div class="empty-icon">📅</div><div class="empty-title">No upcoming events yet</div><div class="empty-sub">${state.isAdmin?'Add a social or set up the quarterly tournaments.':'Quarterly tournaments and socials will show up here.'}</div></div>`;
  const hasQ = state.events.some(e=>e.type==='tournament'&&(e.date||'').startsWith('2027'));
  $('seedBox').hidden=!(state.isAdmin&&!hasQ);
  if(state.isAdmin&&!hasQ) $('seedBox').innerHTML=`<div class="card" style="padding:14px 16px;border-color:var(--gold)">
      <div style="font-weight:700">🏆 Set up the 2027 quarterly tournaments</div>
      <div style="font-size:12.5px;color:var(--fg2);margin:4px 0 10px;line-height:1.5">Adds four tournaments: Sat Mar 27, Sat Jun 26, Sat Sep 25 and Sat Dec 18 (moved off Christmas). You can edit any date, time or detail afterwards.</div>
      <button class="btn btn-primary btn-sm" onclick="seedQuarterlies()">Add all four</button></div>`;
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
        <div style="flex:1;min-width:0"><div class="ev-title">${T.icon} ${esc(e.title)}</div><div class="ev-meta">${esc(fmtWhen(e))}</div>
          ${going?`<div class="ev-meta" style="color:var(--green);font-weight:600">You\u2019re ${T.who==='entered'?'entered':'going'} \u2713</div>`:''}</div>
        <span style="color:var(--fg2);font-size:20px">\u203a</span>
      </div></div>`;
}
async function toggleRsvp(id){
  const e=state.events.find(x=>x.id===id); if(!e) return;
  const mine=(e.rsvps||[]).includes(state.email); const T=EVENT_TYPES[e.type]||EVENT_TYPES.other;
  if(!mine&&e.capacity&&(e.rsvps||[]).length>=e.capacity){ toast('Sorry \u2014 this one is full'); return; }
  try{ await db.collection('events').doc(id).update({rsvps:mine?FieldValue.arrayRemove(state.email):FieldValue.arrayUnion(state.email)}); toast(mine?'Removed':(e.type==='tournament'?'You\u2019re entered! 🏆':'See you there! 🎉')); }
  catch(err){ toast('Could not update: '+err.message); }
}
function openEventForm(id){
  const e=id?state.events.find(x=>x.id===id):null;
  const v=k=>esc(e&&e[k]!=null?e[k]:'');
  $('sheetName').textContent=e?'Edit event':'New event';
  $('sheetBody').innerHTML=`
    <div class="form-group"><label class="form-label">Type</label>
      <select id="evType" onchange="$('evEligGroup').hidden=this.value!=='tournament'">
        ${Object.entries(EVENT_TYPES).map(([k,T])=>`<option value="${k}" ${(e?e.type:'social')===k?'selected':''}>${T.icon} ${T.label}</option>`).join('')}
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
    rsvpOn:$('evRsvp').checked,capacity:cap>0?cap:null};
  try{
    if(id) await db.collection('events').doc(id).update(data);
    else await db.collection('events').add({...data,rsvps:[],createdBy:state.email,createdAt:FieldValue.serverTimestamp()});
    closeSheet('playerSheet'); toast(id?'Event updated':'Event added 📅');
  }catch(err){ toast('Could not save: '+err.message); }
}
let pendingEventDelete=null;
async function deleteEvent(id){
  if(pendingEventDelete!==id){ pendingEventDelete=id; toast('Tap Delete again to confirm'); setTimeout(()=>{ if(pendingEventDelete===id) pendingEventDelete=null; },4000); return; }
  pendingEventDelete=null;
  try{ await db.collection('events').doc(id).delete(); closeSheet('playerSheet'); toast('Event deleted'); }catch(err){ toast('Could not delete: '+err.message); }
}
async function seedQuarterlies(){
  const qs=[['2027-03-27','Q1'],['2027-06-26','Q2'],['2027-09-25','Q3'],['2027-12-18','Q4']];
  try{
    for(const [date,q] of qs){
      await db.collection('events').add({type:'tournament',title:`${q} Ladder Tournament`,date,start:'08:00',end:'16:00',location:'Gold River Sports Club',
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
    q('How does doubles ranking work?',`<p>Doubles is ranked individually, so you can play with different partners. When you win, you and your partner each get +${WIN}; the losing pair each get ${LOSS}. The <b>Top Pairings</b> list on each doubles ladder shows which partnerships have the best record together.</p>`),
  ])}
  ${sec('Challenges & matches',[
    q('Who can I challenge?',`<p>Anyone up to <b>4 spots above you</b> in the same draw. The Play tab only lists the people you’re allowed to challenge.</p><p><b>New members</b> can challenge <b>anyone in their draw</b> for their first ${OPEN_DAYS/7} weeks, to find their level quickly. Everyone has this open window during the free pre-season and the first ${OPEN_DAYS/7} weeks of the season.</p>`),
    q('How long do we have to play?',`<p><b>${CHALLENGE_DAYS} days</b> from when the challenge is sent. Each challenge on your Home screen shows how much time is left. If it isn’t played in time, Jordan can award the challenger a forfeit win or void the challenge.</p><p>If weather, injury or travel gets in the way, message Jordan before the ${CHALLENGE_DAYS} days are up.</p>`),
    q('Can I decline a challenge?',`<p>Yes, if you can’t play — let the challenger know why. Jordan may treat repeated declines as forfeits.</p>`),
    q('How do we book a court?',`<p>Through Club Automation, the same way you always do. Courts can be booked <b>up to 48 hours in advance</b>.</p><p>Tap <b>Book a court</b> on the Play tab, or on an accepted challenge to open the booking page on your proposed date. If that date is more than 48 hours away, agree on the time with your opponent now and book once it opens up.</p>`),
    q('What’s the match format?',`<p>Best of 3 sets, with a 10-point tiebreak in place of a third set.</p>`),
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
    q('Who do I contact with questions?',`<p>Jordan Boyls, Director of Tennis — <span style="user-select:all;color:var(--accent-hi);font-weight:600">JordanB@sparetimesportsclubs.com</span></p>`),
  ])}`;
  el.dataset.sig=sig;
}

// ═══════════════════════════════════════════
//  MISC
// ═══════════════════════════════════════════
function switchInstall(which,el){ document.querySelectorAll('#installTabs .tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); $('installIOS').hidden=which!=='ios'; $('installAndroid').hidden=which!=='android'; }
let toastTimer;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(10px)'; },2600); }
