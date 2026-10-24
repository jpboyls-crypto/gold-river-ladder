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
(function(){ try{ const e=localStorage.getItem('ladderEmail'); if(e) $('loginEmail').value=e; }catch(_){} if(isStandalone()) showPasteBox(); })();

// ═══════════════════════════════════════════
//  FIRESTORE LISTENERS
// ═══════════════════════════════════════════
function stopListeners(){ unsubs.forEach(u=>u()); unsubs=[]; state.players=[];state.matches=[];state.challenges=[];state.hits=[];state.signups=[]; Object.keys(state.ready).forEach(k=>state.ready[k]=false); }
function startListeners(){
  stopListeners();
  const onErr = name => e => { console.error(name, e); if(e.code==='permission-denied'){ onNotMember(); } };
  unsubs.push(db.collection('players').onSnapshot(s=>{ state.players=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.players=true; afterData(); }, onErr('players')));
  unsubs.push(db.collection('matches').orderBy('date','desc').onSnapshot(s=>{ state.matches=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.matches=true; afterData(); }, onErr('matches')));
  unsubs.push(db.collection('challenges').onSnapshot(s=>{ state.challenges=s.docs.map(d=>({id:d.id,...d.data()})); state.ready.challenges=true; afterData(); }, onErr('challenges')));
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
    $('navAdmin').hidden = !state.isAdmin;
    let h = (location.hash||'').replace('#','');
    const map={home:'Home',ladder:'Ladder',challenge:'Challenge',practice:'Practice',profile:'Profile',admin:'Admin',install:'Install'};
    if(!map[h]) h = (state.isAdmin && !me()) ? 'admin' : 'home';
    goPage(map[h], $('nav'+map[h]));
  } else {
    rerender();
  }
}
function rerender(){
  if(currentPage==='Home') renderHome();
  if(currentPage==='Ladder') renderLadder();
  if(currentPage==='Challenge') initChallengePage(true);
  if(currentPage==='Practice') renderPractice();
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
function getRating(p,t){
  const L=LADDERS[t]; let r=p[L.base]||NTRP_BASE[p.ntrp]||1200;
  for(const m of state.matches){ if(m.ladder!==t||!playedIn(m,p.id)) continue; r += wonBy(m,p.id)?WIN:LOSS; }
  return r;
}
function record(p){ let w=0,l=0; for(const m of state.matches){ if(!playedIn(m,p.id)) continue; wonBy(m,p.id)?w++:l++; } return {w,l}; }
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
  state.matches.filter(x=>x.ladder===ladder&&x.p1Partner&&x.p2Partner).forEach(x=>{
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
  const pending=state.challenges.filter(c=>c.status==='pending'&&(c.to===m.id||c.from===m.id)).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  $('heroPending').textContent=pending.length;
  const pList=$('pendingList');
  if(!pending.length){
    pList.innerHTML=`<div class="empty"><div class="empty-icon">🎾</div><div class="empty-title">No pending challenges</div><div class="empty-sub">Issue a challenge from the Play tab.</div></div>`;
  } else {
    pList.innerHTML=pending.map(c=>{
      const otherId=c.from===m.id?c.to:c.from; const other=getPlayer(otherId); const incoming=c.to===m.id;
      return `<div class="match-card" style="border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" onclick="openPlayerSheet('${esc(otherId)}')">${esc(other?other.initials:'?')}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${incoming?'Challenge from':'Challenged'} <b>${esc(displayName(otherId))}</b></div>
            <div style="font-size:12px;color:var(--fg2)">${esc(ladderLabel(c.ladder))} · ${esc(c.date)}</div>
            ${c.message?`<div style="font-size:13px;color:var(--fg2);margin-top:3px;font-style:italic">"${esc(c.message)}"</div>`:''}
          </div>
          <span class="chip chip-gold">Pending</span>
        </div>
        ${incoming?`<div class="match-actions">
          <button class="btn btn-green btn-sm" onclick="respondChallenge('${c.id}','accepted')">Accept</button>
          <button class="btn btn-secondary btn-sm" onclick="respondChallenge('${c.id}','declined')">Decline</button>
          ${other&&other.phone?`<a class="btn btn-secondary btn-sm" href="sms:${esc(other.phone.replace(/\\D/g,''))}">Text</a>`:''}
        </div>`:`<div class="match-actions"><button class="btn btn-secondary btn-sm" onclick="cancelChallenge('${c.id}')">Withdraw</button>${other&&other.phone?`<a class="btn btn-secondary btn-sm" href="sms:${esc(other.phone.replace(/\\D/g,''))}">Text ${esc(other.name.split(' ')[0])}</a>`:''}</div>`}
      </div>`;
    }).join('');
  }
  const myMatches=state.matches.filter(x=>playedIn(x,m.id)).slice(0,5);
  $('recentList').innerHTML=myMatches.length?recentMatchesHtml(myMatches,m.id):`<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No matches yet</div><div class="empty-sub">Submit your first match score to get started.</div></div>`;
}
function recentMatchesHtml(list,viewerId){
  if(!list.length) return `<div class="empty"><div class="empty-title">No matches recorded yet</div></div>`;
  return list.map(match=>{
    if(viewerId){
      const won=wonBy(match,viewerId);
      return `<div class="match-card" style="border-bottom:1px solid var(--border)"><div class="match-vs"><div class="match-player">
        <div class="match-player-name">${matchLine(match,viewerId)}</div>
        <div class="match-player-rating">${esc(ladderLabel(match.ladder))} · ${esc(match.date)}</div></div>
        <span class="score-pill ${won?'w':'l'}">${won?'W':'L'} ${esc(match.score)}</span></div></div>`;
    }
    return `<div class="match-card" style="border-bottom:1px solid var(--border)"><div class="match-player-name">${esc(displayName(match.p1))}${match.p1Partner?' &amp; '+esc(displayName(match.p1Partner)):''} def. ${esc(displayName(match.p2))}${match.p2Partner?' &amp; '+esc(displayName(match.p2Partner)):''}</div>
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
        <div class="rank-meta">NTRP ${esc(p.ntrp)} · ${rec.w}W ${rec.l}L${showUTR&&utr?` · <span class="utr-badge" style="vertical-align:middle"><span class="utr-label">UTR</span>${Number(utr).toFixed(2)}</span>`:''}</div></div>
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
  if(!keep){ const d=new Date(); d.setDate(d.getDate()+7); $('chlDate').value=d.toISOString().split('T')[0]; $('scoreDatePlayed').value=today(); }
}
function populateOpponentsFor(ladder,selectId){
  const sel=$(selectId), keep=sel.value;
  if(!ladder||!LADDERS[ladder]){ sel.innerHTML=`<option value="">—</option>`; return; }
  const ranked=getRanked(ladder), myRank=ranked.findIndex(p=>p.id===state.email);
  const challengeable=myRank>0?ranked.filter((p,i)=>i<myRank).slice(-4):[];
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
async function sendChallenge(){
  const to=$('chlOpponent').value, ladder=$('chlLadder').value;
  if(!to){ toast('No eligible opponents above you'); return; }
  if(state.challenges.some(c=>c.status==='pending'&&c.from===state.email&&c.to===to&&c.ladder===ladder)){ toast('You already have a pending challenge with them'); return; }
  try{
    await db.collection('challenges').add({from:state.email,to,ladder,date:$('chlDate').value,message:$('chlMessage').value.trim().slice(0,300),status:'pending',createdAt:FieldValue.serverTimestamp()});
    $('chlMessage').value=''; toast('Challenge sent! 🎾');
  }catch(e){ toast('Could not send: '+e.message); }
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
    await db.collection('matches').add({p1:state.email,p1Partner,p2:opp,p2Partner,ladder,score:score.slice(0,40),winner,date,submittedBy:state.email,createdAt:FieldValue.serverTimestamp()});
    // auto-close any pending challenge between these two in this draw
    state.challenges.filter(c=>c.status!=='declined'&&c.status!=='played'&&c.ladder===ladder&&((c.from===state.email&&c.to===opp)||(c.from===opp&&c.to===state.email)))
      .forEach(c=>db.collection('challenges').doc(c.id).update({status:'played'}).catch(()=>{}));
    $('scoreInput').value=''; toast('Score submitted! Rankings updated. 🎾');
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
function renderAdminMatches(){
  $('adminMatchList').innerHTML=state.matches.length?state.matches.map(m=>`<div class="match-card" style="border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="min-width:0"><div style="font-weight:600;font-size:14px">${esc(displayName(m.p1))}${m.p1Partner?' &amp; '+esc(displayName(m.p1Partner)):''} vs ${esc(displayName(m.p2))}${m.p2Partner?' &amp; '+esc(displayName(m.p2Partner)):''}</div>
      <div style="font-size:12px;color:var(--fg2)">${esc(ladderLabel(m.ladder))} · ${esc(m.date)} · W: ${esc(displayName(m.winner))} · by ${esc(displayName(m.submittedBy))}</div><div style="font-size:13px;margin-top:2px">${esc(m.score)}</div></div>
      <button class="btn btn-danger btn-sm" onclick="deleteMatch('${m.id}')">Del</button></div></div>`).join('')
    :`<div class="empty"><div class="empty-title">No matches recorded</div></div>`;
}
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
function welcomeText(p){
  const first=(p.name||'').split(' ')[0]||'there';
  const draws=playerLadders(p).map(t=>LADDERS[t].label).join(', ');
  return `Hi ${first}, you're in! Welcome to the Gold River Tennis Ladder${draws?' ('+draws+')':''}.\n\n`+
    `1) Open the app: ${APP_URL}\n`+
    `2) Sign in with ${p.email} \u2014 it emails you a one-tap sign-in link (check spam the first time).\n`+
    `3) Add it to your home screen: Profile \u2192 Install on your phone.\n\n`+
    `Play is free until the official season starts Jan 1, 2027. Challenge someone or post on the Practice tab to find a hit.\n\n\u2014 Jordan`;
}
function smsHref(phone,body){ const n=(phone||'').replace(/\D/g,''); const ios=/iPad|iPhone|iPod/.test(navigator.userAgent); return `sms:${n}${ios?'&':'?'}body=${encodeURIComponent(body)}`; }
function openWelcome(id){
  const p=getPlayer(id); if(!p) return;
  const body=welcomeText(p);
  $('sheetName').textContent='Send welcome';
  $('sheetBody').innerHTML=`
    <div style="font-size:13.5px;color:var(--fg2);line-height:1.5;margin-bottom:12px"><b style="color:var(--fg)">${esc(p.name)}</b> is on the ladder. The app doesn\u2019t send emails on its own, so send them this welcome from your phone \u2014 it opens your Messages or Mail app with everything filled in.</div>
    <pre style="white-space:pre-wrap;word-break:break-word;font:13px/1.5 Inter,system-ui,sans-serif;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:14px" id="welcomeBody">${esc(body)}</pre>
    <div style="display:grid;gap:8px">
      ${p.phone?`<a class="btn btn-green btn-full" href="${esc(smsHref(p.phone,body))}">Text it to ${esc(p.phone)}</a>`:''}
      <a class="btn ${p.phone?'btn-secondary':'btn-green'} btn-full" href="googlegmail:///co?to=${encodeURIComponent(p.email)}&subject=${encodeURIComponent('You\u2019re on the Gold River Tennis Ladder')}&body=${encodeURIComponent(body)}">Email it from the Gmail app</a>
      <a class="btn btn-secondary btn-full" href="mailto:${esc(p.email)}?subject=${encodeURIComponent('You\u2019re on the Gold River Tennis Ladder')}&body=${encodeURIComponent(body)}">Email it from Mail</a>
      <button class="btn btn-secondary btn-full" onclick="copyWelcome(this)">Copy message</button>
      <button class="btn btn-secondary btn-full" onclick="closeSheet('playerSheet')">Done</button>
    </div>`;
  $('playerSheet').classList.add('open');
}
async function copyWelcome(btn){
  const t=$('welcomeBody').textContent;
  try{ await navigator.clipboard.writeText(t); btn.textContent='Copied \u2713'; }
  catch(e){ const r=document.createRange(); r.selectNodeContents($('welcomeBody')); const s=getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent='Selected \u2014 tap Copy'; }
}
let pendingPlayerDelete=null;
async function adminDeletePlayer(id){
  if(pendingPlayerDelete!==id){ pendingPlayerDelete=id; toast('Tap Delete again to confirm'); setTimeout(()=>{ if(pendingPlayerDelete===id) pendingPlayerDelete=null; },4000); return; }
  pendingPlayerDelete=null;
  try{ await db.collection('players').doc(id).delete(); toast('Player deleted'); closeSheet('playerSheet'); }catch(e){ toast('Could not delete: '+e.message); }
}
async function adminToggleActive(id,makeActive){
  try{ await db.collection('players').doc(id).update({active:makeActive}); toast(makeActive?'Reactivated':'Marked inactive'); closeSheet('playerSheet'); }catch(e){ toast('Could not update: '+e.message); }
}

// ═══════════════════════════════════════════
//  MISC
// ═══════════════════════════════════════════
function switchInstall(which,el){ document.querySelectorAll('#installTabs .tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); $('installIOS').hidden=which!=='ios'; $('installAndroid').hidden=which!=='android'; }
let toastTimer;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(10px)'; },2600); }
