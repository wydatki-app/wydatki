// Dashboard wydatków — port z analiza_wydatkow.py (HTML_TEMPLATE). Startuje po imporcie danych.
// Zapis ustawień przez wApi() = lokalna atrapa API serwera (src/rdzen/magazyn.js), bez sieci.
globalThis.W.uruchomDashboard = function (DATA) {
const wApi = (u, o) => globalThis.W.api(u, o), wPrzeladuj = () => globalThis.W.przeladuj();
const I=globalThis.W.i18n, t=globalThis.W.t, tH=globalThis.W.tH;
const _t=t;   // alias: w funkcjach, gdzie `t` oznacza transakcję (parametr/zmienna), tłumaczenia wołamy przez _t
const PAL = DATA.pal, fmt = n => I.liczba(n,2);
const fmt0 = n => I.liczba(Math.round(n),0);
// bezpieczne kodowanie ID (zawiera | oraz znaki z opisów) do atrybutu data-id
const enc = s => encodeURIComponent(s), dec = s => decodeURIComponent(s);
// escapowanie HTML — opisy z wyciągów i nazwy z plików ustawień nie mogą wstrzyknąć znaczników
const escH = s => String(s==null?'':s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let period = 'all';       // 'all' | 'YYYY-MM'
let selCat = null;        // wybrana kategoria (drill-down)

// --- wykluczenia "do zwrotu" ---
// tryb serwera: zapis do zwroty.json przez API (wspólne dla wszystkich przeglądarek na tym Macu)
// tryb pliku:   localStorage (per przeglądarka)
const SERVER = !!DATA.server, LS_KEY = 'wydatki_zwroty_v1';
let refunds = new Set(SERVER ? [] : JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
function isRefund(t){ return refunds.has(t.id); }
async function saveRefunds(){
  if(SERVER){
    try{ await wApi('/api/zwroty',{method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify([...refunds])}); }
    catch(e){ alert(t('d.err_serwer',{blad:e.message})); }
  } else { localStorage.setItem(LS_KEY, JSON.stringify([...refunds])); }
}
async function toggleRefund(id){
  refunds.has(id)?refunds.delete(id):refunds.add(id);
  await saveRefunds(); renderAll();
}
async function loadRefunds(){
  if(!SERVER) return;
  try{ const r=await wApi('/api/zwroty'); if(r.ok) refunds=new Set(await r.json()); }
  catch(e){ console.warn('Brak zwrotów z serwera:',e.message); }
}

// --- ręczne przypisania kategorii (override per transakcja) ---
const LS_KAT = 'wydatki_kategorie_v1';
let overrides = SERVER ? {} : JSON.parse(localStorage.getItem(LS_KAT) || '{}');
// efektywna kategoria: ręczne przypisanie wygrywa nad regułą z kategorie.yaml
function effCat(t){ return overrides[t.id] || t.c; }
async function saveOverrides(){
  if(SERVER){
    try{ await wApi('/api/kategorie',{method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify(overrides)}); }
    catch(e){ alert(t('d.err_kat_serwer',{blad:e.message})); }
  } else { localStorage.setItem(LS_KAT, JSON.stringify(overrides)); }
}
async function setCat(id, cat, orig){
  if(!cat || cat===orig) delete overrides[id];   // powrót do reguły = usuń override
  else overrides[id]=cat;
  await saveOverrides(); renderAll();
}
async function loadOverrides(){
  if(!SERVER) return;
  try{ const r=await wApi('/api/kategorie'); if(r.ok) overrides=await r.json(); }
  catch(e){ console.warn('Brak override z serwera:',e.message); }
}

// --- własne kategorie (dodawane z dashboardu, niezależne od kategorie.yaml) ---
// tryb serwera: kategorie_wlasne.json; tryb pliku: localStorage
const LS_WLASNE = 'wydatki_kategorie_wlasne_v1';
const NAZWA_OK = /^[\p{L}\p{N} ()+&.\/_-]{1,40}$/u;
let wlasne = SERVER ? (DATA.kategorie_wlasne||[]).slice()
                    : JSON.parse(localStorage.getItem(LS_WLASNE) || '[]');
const zRegul = () => new Set((DATA.kategorie||[]).map(c=>c.toLowerCase()));

async function saveWlasne(){
  if(SERVER){
    const r=await wApi('/api/kategorie-wlasne',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(wlasne)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok) throw new Error(j.error||('HTTP '+r.status));
    wlasne=j.kategorie||wlasne;          // serwer jest źródłem prawdy (normalizuje nazwy)
  } else { localStorage.setItem(LS_WLASNE, JSON.stringify(wlasne)); }
}
async function loadWlasne(){
  if(!SERVER) return;
  try{ const r=await wApi('/api/kategorie-wlasne'); if(r.ok) wlasne=await r.json(); }
  catch(e){ console.warn('Brak własnych kategorii z serwera:',e.message); }
}

// Dodaje kategorię. Zwraca finalną nazwę albo null (anulowane / błąd).
async function dodajKategorie(raw){
  const nazwa=(raw||'').trim().replace(/\s+/g,'_');
  if(!nazwa) return null;
  if(!NAZWA_OK.test(nazwa)){ alert(t('d.nazwa_zla')); return null; }
  const istnieje=[...catList()].find(c=>c.toLowerCase()===nazwa.toLowerCase());
  if(istnieje) return istnieje;          // już jest — po prostu jej użyj
  const przed=wlasne.slice();
  wlasne.push(nazwa);
  try{ await saveWlasne(); }
  catch(e){ wlasne=przed; alert(t('d.err_kat',{blad:e.message})); return null; }
  return nazwa;
}

// Usuwa własną kategorię; transakcje z override na nią wracają do reguły.
async function usunKategorie(nazwa){
  const uzyte=Object.entries(overrides).filter(([,c])=>c===nazwa).map(([id])=>id);
  const pyt=uzyte.length
    ? t('d.usun_kat_tx',{nazwa,n:uzyte.length})
    : t('d.usun_kat',{nazwa});
  if(!confirm(pyt)) return;
  const przedW=wlasne.slice(), przedO={...overrides};
  wlasne=wlasne.filter(c=>c!==nazwa);
  uzyte.forEach(id=>delete overrides[id]);
  try{ await saveWlasne(); await saveOverrides(); }
  catch(e){ wlasne=przedW; overrides=przedO; alert(t('d.nie_usunieto',{blad:e.message})); }
  renderAll();
}

// --- reguły własne (reguly_wlasne.json): fragment opisu → kategoria, pierwszeństwo przed kategorie.yaml ---
// Użytkownik wpisuje zwykły tekst; zamiana na wzorzec ze znakami specjalnymi escapowanymi (bez regex „przez przypadek”).
let reguly=[], konf={};
const RG=()=>globalThis.W.reguly;
const naWzorzec=s=>String(s||'').trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
const odWzorca=w=>String(w||'').replace(/\\s\+/g,' ').replace(/\\(.)/g,'$1');
const testerWzorca=wz=>{ try{ const rx=new RegExp(wz.replace(/\(\?P</g,'(?<'),'i'); return t=>rx.test(t.o); }catch(e){ return null; } };
async function loadReguly(){ try{ const r=await wApi('/api/reguly-wlasne'); if(r.ok) reguly=await r.json(); }catch(e){ console.warn(e.message); } }
async function loadKonf(){ try{ const r=await wApi('/api/konfiguracja'); if(r.ok) konf=await r.json(); }catch(e){ console.warn(e.message); } }

// --- ŹRÓDŁA: bank → karta/rachunek (t.z = "bank" | "bank:k1234" | "bank:r1234", z importu) ---
const BANK_N={millennium:'Millennium',velo:'VeloBank',revolut:'Revolut',alior:'Alior',mbank:'mBank',pkobp:'PKO BP',bnp:'BNP Paribas',ofx:'OFX/QFX'};
const BANK_ORDER=Object.keys(BANK_N);
const ZR_OK=globalThis.W.model.ZRODLO_RE;
// budowa DOM bez innerHTML: teksty jako węzły tekstowe, atrybuty przez właściwości/setAttribute
function h(tag,props,...kids){
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(k==='class') e.className=v; else if(k==='style') e.style.cssText=v;
    else if(k.startsWith('data-')) e.setAttribute(k,v); else e[k]=v;
  }
  for(const c of kids.flat()) if(c!=null&&c!==false) e.append(c);
  return e;
}
const zrOf=t=>ZR_OK.test(t.z||'')?t.z:'';
const zrBank=z=>z?z.split(':')[0]:'';
const nazwyZr=()=>konf.nazwy_zrodel||{};
const bankNazwa=b=>BANK_N[b]||t('d.nieznane');
function zrDomyslna(z){ const k=z.split(':')[1]; if(!k) return t('d.zr_bez_numeru'); const typ=k[0]==='k'?t('d.karta'):t('d.rachunek'); return k.length>1?`${typ} …${k.slice(1)}`:typ; }
const zrNazwa=z=>nazwyZr()[z]||zrDomyslna(z);
function zrPelna(z){ if(!z) return t('d.zr_nieznane'); const n=nazwyZr()[z]||(z.includes(':')?zrDomyslna(z):''); return bankNazwa(zrBank(z))+(n?' · '+n:''); }
const zrKolor=b=>PAL[Math.max(0,BANK_ORDER.indexOf(b))%PAL.length];
const zrPasuje=(t,f)=>!f||(f.startsWith('b:')?zrBank(zrOf(t))===f.slice(2):zrOf(t)===f.slice(2));
const zrPokazSub=zs=>zs.length>1||zs.some(z=>z.includes(':'));   // bank z jednym źródłem bez numeru = bez podwierszy
async function zapiszUst(url, dane, co){
  const r=await wApi(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(dane)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok){ alert(t('d.nie_zapisano_co',{co,blad:j.error||('HTTP '+r.status)})); return false; }
  return true;
}
// kategorie z reguł liczone są przy imporcie → po zmianie reguł/ustawień przeliczenie całości
async function dodajRegule(tekst, kat){
  const wz=naWzorzec(tekst);
  if(!wz||!kat) return false;
  if(reguly.some(r=>r.wzorzec===wz&&r.kategoria===kat)) return true;
  if(!(await zapiszUst('/api/reguly-wlasne',[...reguly,{wzorzec:wz,kategoria:kat}],t('d.co_regula')))) return false;
  wPrzeladuj(); return true;
}
async function usunRegule(i){
  const r=reguly[i]; if(!r||!confirm(t('d.usun_regule',{wzorzec:odWzorca(r.wzorzec),kat:r.kategoria.replace(/_/g,' ')}))) return;
  if(await zapiszUst('/api/reguly-wlasne',reguly.filter((_,j)=>j!==i),t('d.co_regula'))) wPrzeladuj();
}
// po ręcznej zmianie kategorii: czy przenieść też podobne (i przyszłe) transakcje — tylko gdy jest co przenieść
async function proponujRegule(id, kat){
  const t=DATA.out.find(x=>x.id===id); if(!t||!RG()) return;
  const wz=RG().sugestia(t.o), test=wz&&testerWzorca(wz); if(!test) return;
  const inne=DATA.out.filter(x=>x.id!==id && effCat(x)!==kat && test(x));
  if(!inne.length) return;
  const odp=prompt(_t('d.podobny_opis',{n:inne.length,opis:inne[0].o.slice(0,40),kat:kat.replace(/_/g,' ')}), odWzorca(wz));
  if(odp&&odp.trim()) await dodajRegule(odp, kat);
}

// --- tagi (np. wyjazd) — wiele tagów na transakcję, przekrojowo przez kategorie i miesiące ---
// tryb serwera: tagi.json ({ID: [tag, ...]}); tryb pliku: localStorage
const LS_TAGI = 'wydatki_tagi_v1';
let tagi = SERVER ? {} : JSON.parse(localStorage.getItem(LS_TAGI) || '{}');
let selTag = null;                       // rozwinięty tag w karcie Tagi
let bulk = {tag:'', od:'', do:'', f:'', preview:null, checked:new Set()};   // formularz tagowania hurtem
// okres podglądu tagów: 'all' | 'tab' (jak zakładka miesiąca) | 'YYYY-MM' | 'range' (od–do)
let tagPer = {mode:'all', od:'', do:''};
try{ const z=JSON.parse(localStorage.getItem('wydatki_tagi_okres_v1')||'null'); if(z&&z.mode) tagPer=z; }catch(e){}
function inTagPer(t){
  const m=tagPer.mode;
  if(m==='all') return true;
  if(m==='tab') return inPeriod(t);
  if(m==='range') return (!tagPer.od || t.d>=tagPer.od) && (!tagPer.do || t.d<=tagPer.do);
  return t.d.slice(0,7)===m;
}
function tagPerLabel(){
  const m=tagPer.mode;
  if(m==='all') return t('d.caly_okres');
  if(m==='tab') return period==='all'?t('d.caly_okres_zakl'):t('d.jak_zakladka',{m:mLbl(period)});
  if(m==='range') return `${tagPer.od||'…'} → ${tagPer.do||'…'}`;
  return mLbl(m);
}
// tagi z reguł (t.at, z kategorie.yaml) + ręczne (tagi.json); reguła nie dubluje ręcznego
// wpis "-Tag" w tagi.json = tag z reguły wyłączony dla tej transakcji
function tagsOf(t){ const man=tagi[t.id]||[], off=new Set(man.filter(x=>x[0]==='-').map(x=>x.slice(1)));
  return [...new Set([...(t.at||[]), ...man.filter(x=>x[0]!=='-')])].filter(g=>!off.has(g)); }
const isAutoTag = (t,g) => (t.at||[]).includes(g) && !(tagi[t.id]||[]).includes(g);
function allTags(){ const s=new Set(); Object.values(tagi).forEach(a=>a.forEach(x=>{ if(x[0]!=='-') s.add(x); })); DATA.out.forEach(t=>(t.at||[]).forEach(x=>s.add(x))); return [...s].sort(); }
function normTag(raw){
  const n=(raw||'').trim().replace(/\s+/g,'_');
  if(!n) return null;
  if(!NAZWA_OK.test(n)){ alert(t('d.nazwa_tagu_zla')); return null; }
  return allTags().find(x=>x.toLowerCase()===n.toLowerCase()) || n;   // istniejący tag niezależnie od wielkości liter
}
async function saveTagi(){
  if(SERVER){
    try{ const r=await wApi('/api/tagi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(tagi)});
         const j=await r.json().catch(()=>({})); if(!r.ok||!j.ok) throw new Error(j.error||('HTTP '+r.status)); }
    catch(e){ alert(t('d.nie_zapisano_tagow',{blad:e.message})); }
  } else { localStorage.setItem(LS_TAGI, JSON.stringify(tagi)); }
}
async function loadTagi(){
  if(!SERVER) return;
  try{ const r=await wApi('/api/tagi'); if(r.ok) tagi=await r.json(); }
  catch(e){ console.warn('Brak tagów z serwera:',e.message); }
}
async function addTag(ids, tag){
  ids.forEach(id=>{ const a=(tagi[id]||[]).filter(x=>x!=='-'+tag); if(!a.includes(tag)) a.push(tag); tagi[id]=a; });
  await saveTagi(); renderAll();
}
async function suppressAutoTag(id, tag){            // wyłącz tag z reguły dla jednej transakcji
  const a=tagi[id]||[]; if(!a.includes('-'+tag)) tagi[id]=[...a,'-'+tag];
  await saveTagi(); renderAll();
}
async function removeTag(id, tag){
  const a=(tagi[id]||[]).filter(x=>x!==tag);
  if(a.length) tagi[id]=a; else delete tagi[id];
  await saveTagi(); renderAll();
}
async function deleteTagAll(tag){
  const n=Object.values(tagi).filter(a=>a.includes(tag)).length;   // tylko ręczne (wpisy "-Tag" nie liczą się)
  if(!n){ alert(t('d.tag_z_regul',{tag})); return; }
  if(!confirm(t('d.usun_tag',{tag,n}))) return;
  for(const id in tagi){ const a=tagi[id].filter(x=>x!==tag); if(a.length) tagi[id]=a; else delete tagi[id]; }
  if(selTag===tag) selTag=null;
  await saveTagi(); renderAll();
}

// --- budżety: limit na kategorie i/lub tagi, okres miesiąc/rok, wyjątki per miesiąc ---
// tryb serwera: budzety.json; tryb pliku: localStorage
const LS_BUD='wydatki_budzety_v1';
let budzety = SERVER ? (DATA.budzety||[]).slice() : JSON.parse(localStorage.getItem(LS_BUD) || JSON.stringify(DATA.budzety||[]));
let selBud = null;
async function saveBudzety(){
  if(SERVER){
    try{ const r=await wApi('/api/budzety',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(budzety)});
         const j=await r.json().catch(()=>({})); if(!r.ok||!j.ok) throw new Error(j.error||('HTTP '+r.status)); }
    catch(e){ alert(t('d.nie_zapisano_bud',{blad:e.message})); await loadBudzety(); }   // odrzucone → stan sprzed zmiany
  } else { localStorage.setItem(LS_BUD, JSON.stringify(budzety)); }
}
async function loadBudzety(){
  if(!SERVER) return;
  try{ const r=await wApi('/api/budzety'); if(r.ok) budzety=await r.json(); }
  catch(e){ console.warn('Brak budżetów z serwera:',e.message); }
}

// --- zestaw miesięcy ---
const months = [...new Set(DATA.out.map(t=>t.d.slice(0,7)))].sort();

function inPeriod(t){ return period==='all' || t.d.slice(0,7)===period; }
// outRows() = wydatki liczone (BEZ oznaczonych do zwrotu); refundRows() = pula zwrotów
function outRows(){ return DATA.out.filter(t=>inPeriod(t) && !isRefund(t)); }
function refundRows(){ return DATA.out.filter(t=>inPeriod(t) && isRefund(t)); }
function inRows(){ return DATA.in.filter(inPeriod); }

function byCat(rows){
  const m={}; rows.forEach(t=>m[effCat(t)]=(m[effCat(t)]||0)+t.k);
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
}
// stały kolor per kategoria — indeks z pełnej listy kategorii (nie zmienia się przy override)
const CAT_ORDER = (DATA.kategorie||[]).slice();
function catColor(cat){
  let i=CAT_ORDER.indexOf(cat);
  if(i<0){ i=CAT_ORDER.length; CAT_ORDER.push(cat); }   // kategoria spoza reguł (np. tylko w override)
  return PAL[i%PAL.length];
}

// --- okresy, dekompozycja FIRE (ta sama logika co write_summary → PODSUMOWANIE.md) ---
const CUR=(()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;})();
const CFG=Object.assign({n:4,jedn:300,syn:[],wyd:[],fire_mc:5000,swr:0.04}, DATA.sumcfg||{});
const fullMonths=months.filter(m=>m<CUR);
const mLong=m=>I.miesiac(m,true), mLbl=m=>I.miesiac(m,false);
const dim=m=>{const[y,mo]=m.split('-').map(Number);return new Date(y,mo,0).getDate();};
const prevFull=(m,n)=>fullMonths.filter(x=>x<m).slice(-n);          // n pełnych miesięcy przed m
const refMonths=()=>period==='all' ? fullMonths.slice(-CFG.n) : [period];
const sumK=rs=>rs.reduce((s,t)=>s+t.k,0);
const nfm=(n,o)=>n.toLocaleString(I.locale(),o);
const fmtM=n=>n>=1e6?t('d.fmt_mln',{n:nfm(n/1e6,{maximumFractionDigits:2})}):t('d.fmt_tys',{n:fmt0(n/1000)});
// frakcja upływu miesiąca (1 dla zamkniętych)
const monthFrac=m=>m===CUR?new Date().getDate()/dim(m):(m<CUR?1:0);
function layer(t){
  const c=effCat(t), g=tagsOf(t);
  const rl=globalThis.W.reguly.rola(c);   // role: nazwy z domyślnych reguł PL i EN
  if(rl==='podroze') return 'podr';
  if(g.some(x=>CFG.syn.includes(x))) return 'syn';
  if(rl==='rodzina') return 'rodz';
  if(g.some(x=>CFG.wyd.includes(x))) return 'wyd';
  return t.k>=CFG.jedn ? 'jedn' : 'biez';
}
// średnia miesięczna warstw z listy miesięcy
function decomp(ms){
  const r={razem:0,podr:0,syn:0,rodz:0,wyd:0,jedn:0,biez:0}, set=new Set(ms);
  DATA.out.forEach(t=>{ if(isRefund(t)||!set.has(t.d.slice(0,7))) return; r.razem+=t.k; r[layer(t)]+=t.k; });
  const n=ms.length||1; for(const k in r) r[k]/=n;
  r.ja=r.jedn+r.biez; r.bezpodr=r.razem-r.podr; return r;
}

// --- tooltip wspólny dla wykresów ---
const TIP=document.getElementById('tip');
function tipShow(e,html){
  TIP.innerHTML=html; TIP.style.opacity=1;
  const w=TIP.offsetWidth,h=TIP.offsetHeight; let x=e.clientX+14,y=e.clientY+14;
  if(x+w>innerWidth-8) x=e.clientX-w-14; if(y+h>innerHeight-8) y=e.clientY-h-14;
  TIP.style.left=x+'px'; TIP.style.top=y+'px';
}
function tipHide(){ TIP.style.opacity=0; }
const tipRow=(lbl,v,col)=>`<div class="r"><span>${col?`<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${col};margin-right:6px"></i>`:''}${lbl}</span><span>${v}</span></div>`;

// --- nawigacja widoków ---
const VIEWS=['przeglad','transakcje','budzety','trendy','tagi','ustawienia'];
let view='przeglad';
try{ view=localStorage.getItem('wydatki_widok_v1')||view; }catch(e){}
if(VIEWS.includes(location.hash.slice(1))) view=location.hash.slice(1);
if(!VIEWS.includes(view)) view='przeglad';
function setView(v){
  view=v;
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.dataset.view===v));
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.v===v));
  try{ localStorage.setItem('wydatki_widok_v1',v); }catch(e){}
  history.replaceState(null,'','#'+v);
}
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>{ setView(b.dataset.v); scrollTo(0,0); });
setView(view);

// --- wybór okresu: domyślnie bieżący miesiąc, a w pierwszym tygodniu — ostatni pełny ---
if(months.length){
  period = (months.includes(CUR) && new Date().getDate()>7) ? CUR : (fullMonths[fullMonths.length-1]||months[months.length-1]);
}
function setPeriod(p){ period=p; selCat=null; renderAll(); }
function renderTabs(){
  const S=document.getElementById('tabs');
  S.innerHTML=`<option value="all">${escH(t('d.caly_okres_cap'))}</option>`+months.slice().reverse()
    .map(m=>`<option value="${m}">${mLong(m)}${m===CUR?escH(t('d.w_toku')):''}</option>`).join('');
  S.value=period; S.onchange=()=>setPeriod(S.value);
  const i=months.indexOf(period), P=document.getElementById('per-prev'), N=document.getElementById('per-next');
  P.disabled = period!=='all' && i<=0;
  N.disabled = period==='all' || i>=months.length-1;
  P.onclick=()=>setPeriod(period==='all'?months[months.length-1]:months[i-1]);
  N.onclick=()=>setPeriod(months[i+1]);
}

// --- KPI ---
function dlt(cur,base,lbl){
  if(!base) return '';
  const d=cur-base, p=Math.round(100*d/base);
  if(Math.abs(p)<3) return `<span class="flat">≈ ${lbl}</span>`;
  return `<span class="${d>0?'up':'down'}">${d>0?'▲':'▼'} ${Math.abs(p)}%</span><span>${lbl}</span>`;
}
function kpi(lbl,val,sub,cls){ return `<div class="kpi ${cls||''}"><div class="lbl">${lbl}</div><div class="big">${val}</div>${sub?`<div class="ks">${sub}</div>`:''}</div>`; }
function meter(v,limit){ const p=limit?v/limit:0, col=p>1?'var(--bad)':(p>0.85?'var(--warn)':'var(--good)');
  return `<div class="meter"><i style="width:${Math.min(100,p*100).toFixed(1)}%;background:${col}"></i></div>`; }
function renderKpis(){
  const K=document.getElementById('kpis'), fire=CFG.fire_mc;
  const inc=sumK(inRows()), refs=sumK(refundRows());
  let h='';
  if(period==='all'){
    const ms=refMonths(), d=decomp(ms), lbl=escH(t('d.kpi_sr_z',{n:ms.length}));
    h+=kpi(escH(t('d.kpi_wyd_sr')),I.kwotaH(d.razem),`<span>${lbl}</span>`);
    h+=kpi(escH(t('d.kpi_bez_podrozy')),I.kwotaH(d.bezpodr),`<span>${tH('d.kpi_podroze',{kwota:I.kwota(d.podr)})}</span>`);
    h+=kpi(escH(t('d.kpi_ja_dom')),I.kwotaH(d.ja),`<span>${escH(t('d.kpi_ja_dom_sub'))}</span>`);
    h+=kpi(escH(t('d.kpi_biezacy')),I.kwotaH(d.biez)+'<small>'+escH(t('d.na_mc'))+'</small>',
      `<span>${tH('d.kpi_cel_pas',{p:Math.round(100*d.biez/fire),kwota:I.kwota(fire)})}</span>`+meter(d.biez,fire),'hero');
    h+=kpi(escH(t('d.kpi_wplywy')),I.kwotaH(inc),`<span>${escH(t('d.kpi_wplywy_all'))}</span>`);
  } else {
    const d=decomp([period]), base=decomp(prevFull(period,CFG.n)), f=monthFrac(period), live=f<1;
    const bl=prevFull(period,CFG.n).length, lb=escH(t(live?'d.vs_sr_prorata':'d.vs_sr',{n:bl}));
    const b=k=>base[k]*(live?f:1);
    const prog=live&&f>0.15;
    h+=kpi(escH(t('d.kpi_wydatki')),I.kwotaH(d.razem),dlt(d.razem,b('razem'),lb)+(prog?`<span>${tH('d.kpi_prognoza',{kwota:I.kwota(d.razem/f)})}</span>`:''));
    h+=kpi(escH(t('d.kpi_ja_dom')),I.kwotaH(d.ja),dlt(d.ja,b('ja'),lb));
    const bz=prog?d.biez/f:d.biez;
    h+=kpi(escH(t('d.kpi_biezacy')),I.kwotaH(d.biez),
      dlt(d.biez,b('biez'),lb)+`<span style="flex-basis:100%">${prog?tH('d.prognoza_dot',{kwota:I.kwota(bz)}):''}${tH('d.p_celu',{p:Math.round(100*bz/fire),kwota:I.kwota(fire)})}</span>`+meter(bz,fire),'hero');
    h+=kpi(escH(t('d.kpi_podr_wyd')),I.kwotaH(d.podr+d.wyd),`<span>${tH('d.kpi_dzieci_rodz',{kwota:I.kwota(d.syn+d.rodz)})}</span>`);
    h+=kpi(escH(t('d.kpi_wplywy')),I.kwotaH(inc),`<span>${escH(t('d.kpi_wplywy_m'))}</span>`);
  }
  if(refs) h+=kpi(escH(t('d.kpi_zwroty')),I.kwotaH(refs),`<span>${escH(t('d.kpi_zwroty_sub'))}</span>`);
  K.innerHTML=h;
}

// --- karta FIRE: wodospad od wszystkich wydatków do bieżącego kosztu życia ---
function renderFire(){
  const F=document.getElementById('fire'), ms=refMonths(), d=decomp(ms);
  document.getElementById('fire-scope').textContent = period==='all'
    ? (ms.length?t('d.fire_scope',{od:mLbl(ms[0]),do:mLbl(ms[ms.length-1])}):t('d.brak_pelnych'))
    : mLong(period)+(period===CUR?t('d.w_toku_dot'):'');
  if(!d.razem){ F.innerHTML=`<div class="muted">${escH(t('d.brak_danych_okres'))}</div>`; return; }
  const rows=[[t('d.f_wszystkie'),'razem','tot'],[t('d.f_podroze'),'podr','sub'],[t('d.f_dzieci',{tagi:CFG.syn.join(', ')}),'syn','sub'],
    [t('d.f_rodzina'),'rodz','sub'],[t('d.f_wydarzenia'),'wyd','sub'],[t('d.f_ja_dom'),'ja','tot'],
    [t('d.f_jedn',{kwota:I.kwota(CFG.jedn)}),'jedn','sub'],[t('d.f_biezace'),'biez','hero']];
  let run=d.razem, h='';
  rows.forEach(([lbl,k,typ])=>{
    const v=d[k]; if(typ==='sub' && v<1) return;
    let left=0, w=v/d.razem, col='var(--ref)';
    if(typ==='sub'){ left=(run-v)/d.razem; run-=v; col='var(--s2)'; }
    if(typ==='hero') col='var(--s1)';
    if(typ!=='sub' && k!=='razem') h+='<div class="sep"></div>';
    h+=`<div class="l ${typ!=='sub'?'b':''}" title="${escH(lbl)}">${escH(lbl)}</div>
      <div class="tr"><i style="left:${(left*100).toFixed(2)}%;width:${Math.max(.4,w*100).toFixed(2)}%;background:${col};${typ==='sub'?'opacity:.75':''}"></i></div>
      <div class="v ${typ!=='sub'?'b':''}">${typ==='sub'?'−':''}${fmt0(v)}</div>`;
  });
  const swr=CFG.swr, cap=x=>x*12/swr;
  F.innerHTML=`<div class="wf">${h}</div>
    <div class="firebox">
      <div>${escH(t('d.cap_biezace',{p:Math.round(swr*1000)/10}))}<b>${escH(fmtM(cap(d.biez)))}</b></div>
      <div>${escH(t('d.cap_ja_dom'))}<b>${escH(fmtM(cap(d.ja)))}</b></div>
      <div>${escH(t('d.cel_pasywnie',{kwota:I.kwota(CFG.fire_mc)}))}<b>${escH(fmtM(cap(CFG.fire_mc)))}</b></div>
      <div>${escH(t('d.kazde_100',{kwota:I.kwota(100)}))}<b>−${escH(fmtM(cap(100)))}</b></div>
    </div>`;
}

// --- tempo: narastająco w miesiącu ---
function cumOf(m){
  const n=dim(m), day=new Array(n+1).fill(0);
  DATA.out.forEach(t=>{ if(t.d.startsWith(m)&&!isRefund(t)) day[+t.d.slice(8,10)]+=t.k; });
  const last = m===CUR ? new Date().getDate() : n, out=[];
  let s=0; for(let i=1;i<=last;i++){ s+=day[i]; out.push(s); }
  return out;
}
function renderPace(){
  const P=document.getElementById('pace');
  const M = period==='all' ? (months.includes(CUR)?CUR:months[months.length-1]) : period;
  if(!M){ P.innerHTML=`<div class="muted">${escH(_t('d.brak_danych'))}</div>`; return; }
  document.getElementById('pace-scope').textContent=mLong(M);
  const iM=months.indexOf(M), Mp=iM>0?months[iM-1]:null, base=prevFull(M,CFG.n);
  const series=[{lbl:mLong(M),col:'var(--s1)',w:2.5,v:cumOf(M)}];
  if(Mp) series.push({lbl:mLong(Mp),col:'var(--s2)',w:2,v:cumOf(Mp)});
  if(base.length){ const cs=base.map(cumOf), v=[];
    for(let i=0;i<31;i++) v.push(cs.reduce((s,c)=>s+c[Math.min(i,c.length-1)],0)/cs.length);
    series.push({lbl:_t('d.srednia_mc',{n:base.length}),col:'var(--ref)',w:2,dash:'5 4',v}); }
  const W=560,H=250,l=46,r=14,t=12,b=26, X=d=>l+(d-1)/30*(W-l-r);
  const mx=Math.max(...series.flatMap(s=>s.v),1), step=Math.pow(10,Math.floor(Math.log10(mx/4))), nice=[1,2,2.5,5,10].map(x=>x*step).find(x=>mx/x<=5)||step*10;
  const top=Math.ceil(mx/nice)*nice, Y=v=>H-b-(v/top)*(H-t-b);
  let g='';
  for(let v=0;v<=top+1e-6;v+=nice) g+=`<line class="gl" x1="${l}" x2="${W-r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${l-6}" y="${Y(v)+4}" text-anchor="end">${v>=1000?nfm(v/1000)+escH(_t('d.tys_k')):v}</text>`;
  [1,8,15,22,29].forEach(d=>g+=`<text class="ax" x="${X(d)}" y="${H-8}" text-anchor="middle">${d}</text>`);
  const paths=series.slice().reverse().map(s=>`<path d="${s.v.map((v,i)=>(i?'L':'M')+X(i+1).toFixed(1)+' '+Y(v).toFixed(1)).join(' ')}" style="fill:none;stroke:${s.col};stroke-width:${s.w};stroke-linejoin:round;stroke-linecap:round" ${s.dash?`stroke-dasharray="${s.dash}"`:''}/>`).join('');
  const s0=series[0], lastV=s0.v[s0.v.length-1]||0;
  const end=s0.v.length?`<circle cx="${X(s0.v.length)}" cy="${Y(lastV)}" r="4" style="fill:${s0.col};stroke:var(--card);stroke-width:2"/>`:'';
  P.innerHTML=`<div class="lgd">${series.map(s=>`<span><i class="ln" style="background:${s.col}${s.dash?';opacity:.8':''}"></i>${escH(s.lbl)}</span>`).join('')}</div>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}">${g}${paths}${end}
      <line id="pace-x" y1="${t}" y2="${H-b}" style="stroke:var(--mut);stroke-width:1;opacity:0"/>
      <rect x="${l}" y="${t}" width="${W-l-r}" height="${H-t-b}" fill="transparent" id="pace-hit"/></svg></div>`;
  const svg=P.querySelector('svg'), hit=P.querySelector('#pace-hit'), xl=P.querySelector('#pace-x');
  hit.onmousemove=e=>{
    const rc=svg.getBoundingClientRect(), sx=(e.clientX-rc.left)*W/rc.width;
    const d=Math.max(1,Math.min(31,Math.round((sx-l)/(W-l-r)*30)+1));
    xl.setAttribute('x1',X(d)); xl.setAttribute('x2',X(d)); xl.style.opacity=.5;
    tipShow(e,`<b>${tH('d.dzien',{d})}</b>`+series.map(s=>s.v[d-1]!=null?tipRow(escH(s.lbl),escH(I.kwota(s.v[d-1])),s.col):'').join(''));
  };
  hit.onmouseleave=()=>{ xl.style.opacity=0; tipHide(); };
}

// --- trendy: struktura miesięcy (warstwy FIRE) ---
function renderMonthsChart(){
  const C=document.getElementById('months-chart');
  if(!months.length){ C.innerHTML=`<div class="muted">${escH(_t('d.brak_danych'))}</div>`; return; }
  const L=[['biez',_t('d.l_biezace'),'var(--s1)'],['jedn',_t('d.l_jedn',{n:CFG.jedn}),'var(--s2)'],['rodz',_t('d.l_dzieci_rodz'),'var(--s3)'],['podr',_t('d.kpi_podr_wyd'),'var(--s4)']];
  let data=months.map(m=>{ const d=decomp([m]); return {m, biez:d.biez, jedn:d.jedn, rodz:d.syn+d.rodz, podr:d.podr+d.wyd, tot:d.razem}; });
  // pomiń początkowe miesiące z niepełnymi źródłami (np. tylko Revolut) — < 25% mediany pełnych miesięcy
  const med=(a=>a.length?a[Math.floor(a.length/2)]:0)(data.filter(x=>x.m<CUR).map(x=>x.tot).sort((a,b)=>a-b));
  const i0=data.findIndex(x=>x.tot>=med*.25), pomin=i0>0?data.slice(0,i0).map(x=>x.m):[];
  if(i0>0) data=data.slice(i0);
  const W=Math.max(1000,data.length*60),H=260,l=46,r=14,t=18,b=28, fire=CFG.fire_mc;
  const mx=Math.max(...data.map(x=>x.tot),fire)*1.08, nice=mx>20000?5000:2000, top=Math.ceil(mx/nice)*nice;
  const Y=v=>H-b-(v/top)*(H-t-b), slot=(W-l-r)/data.length, bw=Math.min(44,slot*.6);
  let g='';
  for(let v=0;v<=top;v+=nice) g+=`<line class="gl" x1="${l}" x2="${W-r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${l-6}" y="${Y(v)+4}" text-anchor="end">${nfm(v/1000)}${escH(_t('d.tys_k'))}</text>`;
  data.forEach((x,i)=>{
    const cx=l+slot*i+slot/2; let y0=0, segs='';
    L.forEach(([k,,col],j)=>{ const v=x[k]; if(v<=0) return;
      const y1=Y(y0+v), y2=Y(y0), h=Math.max(0,y2-y1-(y0?2:0));
      segs+=`<rect x="${cx-bw/2}" y="${y1}" width="${bw}" height="${h}" rx="2" style="fill:${col}"/>`; y0+=v; });
    g+=`<g class="mbar" data-i="${i}" style="cursor:pointer">${segs}
      <rect x="${cx-slot/2}" y="${t}" width="${slot}" height="${H-t-b}" fill="transparent"/>
      <text class="ax" x="${cx}" y="${Y(x.tot)-6}" text-anchor="middle" style="fill:var(--txt);font-weight:600">${nfm(x.tot/1000,{maximumFractionDigits:1})}${escH(_t('d.tys_k'))}</text>
      <text class="ax" x="${cx}" y="${H-9}" text-anchor="middle" ${x.m===period?'style="fill:var(--acc);font-weight:700"':''}>${mLbl(x.m)}${x.m===CUR?'*':''}</text></g>`;
  });
  g+=`<line x1="${l}" x2="${W-r}" y1="${Y(fire)}" y2="${Y(fire)}" style="stroke:var(--txt);stroke-width:1.5;opacity:.55" stroke-dasharray="6 4"/>
      <text class="ax" x="${W-r}" y="${Y(fire)-5}" text-anchor="end" style="fill:var(--txt)">${escH(_t('d.cel_mc',{kwota:I.kwota(fire)}))}</text>`;
  C.innerHTML=`<div class="lgd">${L.map(([,lbl,col])=>`<span><i style="background:${col}"></i>${escH(lbl)}</span>`).join('')}<span>${escH(_t('d.mies_leg'))}${pomin.length?escH(_t('d.mies_pomin',{od:mLbl(pomin[0]),do:mLbl(pomin[pomin.length-1])})):''}</span></div>
    <div class="chart" style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="min-width:${W>1000?W+'px':'0'}">${g}</svg></div>`;
  C.querySelectorAll('.mbar').forEach(el=>{ const x=data[+el.dataset.i];
    el.onmousemove=e=>tipShow(e,`<b>${mLong(x.m)}</b>`+L.slice().reverse().map(([k,lbl,col])=>tipRow(escH(lbl),escH(I.kwota(x[k])),col)).join('')+tipRow('<b>'+escH(_t('d.razem'))+'</b>','<b>'+escH(I.kwota(x.tot))+'</b>'));
    el.onmouseleave=tipHide;
    el.onclick=()=>{ tipHide(); setPeriod(x.m); setView('przeglad'); scrollTo(0,0); };
  });
}

// --- transakcje: wyszukiwarka ---
let txf={q:'',cat:'',tag:'',sort:'d',zr:''};
function renderTxList(){
  const sc=document.getElementById('tx-cat'), st=document.getElementById('tx-tag'), so=document.getElementById('tx-sort'), q=document.getElementById('tx-q');
  const sz=document.getElementById('tx-zr'), zs=[...new Set(DATA.out.map(zrOf))];
  const bs=[...new Set(zs.map(zrBank))].sort((a,b)=>BANK_ORDER.indexOf(a)-BANK_ORDER.indexOf(b));
  sz.replaceChildren(h('option',{value:''},t('d.wszystkie_banki')), ...bs.map(b=>{ const sub=zs.filter(z=>zrBank(z)===b).sort();
    return [h('option',{value:'b:'+b},bankNazwa(b)),
      ...(zrPokazSub(sub)?sub.map(z=>h('option',{value:'z:'+z},'\u00a0\u00a0└ '+zrNazwa(z))):[])]; }).flat());
  if(![...sz.options].some(o=>o.value===txf.zr)) txf.zr='';
  sz.value=txf.zr; sz.onchange=()=>{txf.zr=sz.value;renderTxTable();};
  sc.innerHTML=`<option value="">${escH(t('d.wszystkie_kat'))}</option>`+catList().map(c=>`<option value="${escH(c)}">${escH(c.replace(/_/g,' '))}</option>`).join('');
  st.innerHTML=`<option value="">${escH(t('d.wszystkie_tagi'))}</option><option value="__brak">${escH(t('d.bez_tagu'))}</option>`+allTags().map(g=>`<option value="${escH(g)}">🔖 ${escH(g.replace(/_/g,' '))}</option>`).join('');
  sc.value=txf.cat; st.value=txf.tag; so.value=txf.sort; if(q.value!==txf.q) q.value=txf.q;
  sc.onchange=()=>{txf.cat=sc.value;renderTxTable();}; st.onchange=()=>{txf.tag=st.value;renderTxTable();};
  so.onchange=()=>{txf.sort=so.value;renderTxTable();}; q.oninput=()=>{txf.q=q.value;renderTxTable();};
  renderTxTable();
}
function renderTxTable(){
  const ql=txf.q.trim().toLowerCase();
  let rows=DATA.out.filter(t=>inPeriod(t) && zrPasuje(t,txf.zr) && (!ql||t.o.toLowerCase().includes(ql)) && (!txf.cat||effCat(t)===txf.cat)
    && (!txf.tag || (txf.tag==='__brak' ? !tagsOf(t).length : tagsOf(t).includes(txf.tag))));
  rows.sort(txf.sort==='k'?(a,b)=>b.k-a.k:(a,b)=>a.d<b.d?1:(a.d>b.d?-1:b.k-a.k));
  const sum=sumK(rows.filter(t=>!isRefund(t))), LIM=400;
  document.getElementById('tx-sum').textContent=`${rows.length} · ${I.kwota(sum,2)} · ${period==='all'?t('d.caly_okres'):mLong(period)}`;
  const T=document.getElementById('txlist');
  T.innerHTML=rows.length?`<div class="scroll tall"><table>${hdrTx}${rows.slice(0,LIM).map(txRow).join('')}</table></div>
    ${rows.length>LIM?`<div class="muted" style="font-size:12px;margin-top:8px">${tH('d.pokazano',{lim:LIM,n:rows.length})}</div>`:''}`
    :`<div class="muted">${escH(t('d.brak_tx_filtry'))}</div>`;
  bindTxRows(T);
}

function donutSVG(cats,total){
  const cx=100,cy=100,r=90,ri=60; let a=-Math.PI/2,seg='';
  cats.forEach(([cat,v])=>{
    const f=total?v/total:0, a2=a+f*2*Math.PI, large=(a2-a)>Math.PI?1:0;
    const x1=cx+r*Math.cos(a),y1=cy+r*Math.sin(a),x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
    const op=(selCat&&selCat!==cat)?0.25:1;
    seg+=`<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L ${cx} ${cy} Z" fill="${catColor(cat)}" opacity="${op}" data-cat="${escH(cat)}"><title>${escH(cat.replace(/_/g,' '))}: ${escH(I.kwota(v,2))}</title></path>`;
    a=a2;
  });
  return `<svg viewBox="0 0 200 200" class="donut">${seg}<circle cx="${cx}" cy="${cy}" r="${ri}" class="donut-hole"/>`
    +`<text x="${cx}" y="${cy-2}" text-anchor="middle" class="donut-total">${fmt0(total)}</text>`
    +`<text x="${cx}" y="${cy+16}" text-anchor="middle" class="donut-sub">${escH(I.symbol())}</text></svg>`;
}

function renderDonut(){
  const cats=byCat(outRows()), total=cats.reduce((s,x)=>s+x[1],0), mx=cats.length?cats[0][1]:1;
  document.getElementById('cat-hint').textContent = period==='all'?t('d.caly_okres'):mLong(period);
  // Δ vs średnia z poprzednich pełnych miesięcy (pro rata dla bieżącego)
  let base=null;
  if(period!=='all'){ const bm=prevFull(period,CFG.n), f=monthFrac(period);
    if(bm.length){ base={}; DATA.out.forEach(t=>{ if(!isRefund(t)&&bm.includes(t.d.slice(0,7))) base[effCat(t)]=(base[effCat(t)]||0)+t.k/bm.length*f; }); } }
  const dcell=(cat,v)=>{ if(!base) return '<span class="leg-d"></span>'; const b0=base[cat]||0, d=v-b0;
    if(Math.abs(d)<Math.max(b0*.1,20)) return '<span class="leg-d flat">≈</span>';
    return `<span class="leg-d ${d>0?'up':'down'}" title="${tH('d.srednio',{kwota:I.kwota(b0)})}">${d>0?'+':'−'}${fmt0(Math.abs(d))}</span>`; };
  document.getElementById('donut').innerHTML=donutSVG(cats,total);
  document.getElementById('legend').innerHTML=cats.map(([cat,v])=>`
    <div class="leg-row ${selCat===cat?'sel':''}" data-cat="${escH(cat)}">
      <span class="chev">▸</span><span class="dot" style="background:${catColor(cat)}"></span>
      <span class="leg-name">${escH(cat.replace(/_/g,' '))}<div class="mb"><i style="width:${(100*v/mx).toFixed(1)}%;background:${catColor(cat)}"></i></div></span>
      <span class="leg-val">${escH(I.kwota(v,2))}</span>${dcell(cat,v)}
      <span class="leg-pct">${total?Math.round(100*v/total):0}%</span></div>`).join('');
  const pick=e=>{const c=e.currentTarget.dataset.cat;selCat=(selCat===c?null:c);renderDonut();renderDrill();};
  document.querySelectorAll('#legend .leg-row').forEach(el=>el.onclick=pick);
  document.querySelectorAll('#donut path').forEach(el=>el.onclick=pick);
}

// Przegląd: wydatki wg banku → karty/rachunku; klik = Transakcje z filtrem tego źródła
function renderZrodla(){
  const E=document.getElementById('zrodla'); if(!E) return;
  document.getElementById('zr-scope').textContent=period==='all'?t('d.caly_okres'):mLong(period);
  const rows=outRows(), total=sumK(rows), B={};
  for(const t of rows){ const z=zrOf(t), x=B[zrBank(z)]=B[zrBank(z)]||{s:0,zr:{}}; x.s+=t.k; x.zr[z]=(x.zr[z]||0)+t.k; }
  // Δ vs średnia z poprzednich pełnych miesięcy (pro rata dla bieżącego) — jak w kategoriach
  let base=null;
  if(period!=='all'){ const bm=prevFull(period,CFG.n), f=monthFrac(period);
    if(bm.length){ base={}; DATA.out.forEach(t=>{ if(isRefund(t)||!bm.includes(t.d.slice(0,7))) return;
      const z=zrOf(t), v=t.k/bm.length*f; base['b:'+zrBank(z)]=(base['b:'+zrBank(z)]||0)+v; base['z:'+z]=(base['z:'+z]||0)+v; }); } }
  const dcell=(key,v)=>{ if(!base) return h('span',{class:'leg-d'}); const b0=base[key]||0, d=v-b0;
    if(Math.abs(d)<Math.max(b0*.1,20)) return h('span',{class:'leg-d flat'},'≈');
    return h('span',{class:'leg-d '+(d>0?'up':'down'),title:t('d.srednio',{kwota:I.kwota(b0)})},(d>0?'+':'−')+fmt0(Math.abs(d))); };
  const mx=Math.max(1,...Object.values(B).map(x=>x.s));
  const row=(key,label,v,kolor,sub)=>{
    const el=h('div',{class:'leg-row'+(sub?' zr-sub':'')+(txf.zr===key?' sel':''),'data-zr':key,title:t('d.klik_zrodlo')},
      h('span',{class:'chev'},sub?'':'▸'), h('span',{class:'dot',style:`background:${kolor}`}),
      h('span',{class:'leg-name'},label,h('div',{class:'mb'},h('i',{style:`width:${(100*v/mx).toFixed(1)}%;background:${kolor}`}))),
      h('span',{class:'leg-val'},I.kwota(v,2)), dcell(key,v),
      h('span',{class:'leg-pct'},(total?Math.round(100*v/total):0)+'%'));
    el.onclick=()=>{ txf.zr=key; setView('transakcje'); renderTxList(); scrollTo(0,0); };
    return el;
  };
  const banki=Object.entries(B).sort((a,b)=>b[1].s-a[1].s);
  E.replaceChildren(...(banki.length?banki.map(([b,x])=>{
    const zr=Object.entries(x.zr).sort((p,q)=>q[1]-p[1]);
    return [row('b:'+b,bankNazwa(b),x.s,zrKolor(b),false),
      ...(zrPokazSub(zr.map(([z])=>z))?zr.map(([z,v])=>row('z:'+z,zrNazwa(z),v,zrKolor(b),true)):[])];
  }).flat():[h('div',{class:'muted'},t('d.brak_wyd_okres'))]));
}

// lista kategorii do dropdownu (z reguł + własne + ewentualne z override)
// alfabetycznie (polskie znaki), „Inne nieskategoryzowane" zawsze na końcu
const INNE=DATA.inne||'Inne_nieskategoryzowane';
function sortCats(a){ return [...a].sort((x,y)=>(x===INNE)-(y===INNE) || x.localeCompare(y,I.locale(),{sensitivity:'base'})); }
function catList(){
  const s=new Set(CAT_ORDER);
  wlasne.forEach(c=>s.add(c));
  Object.values(overrides).forEach(c=>s.add(c));
  return sortCats(s);
}
function catSelect(t){
  const cur=effCat(t), over=!!overrides[t.id];
  const opts=catList().map(c=>`<option value="${escH(c)}" ${c===cur?'selected':''}>${escH(c.replace(/_/g,' '))}</option>`).join('')
    +`<option value="__nowa__">${escH(_t('d.nowa_kat'))}</option>`;
  return `<select class="catsel ${over?'over':''}" data-id="${enc(t.id)}" data-orig="${escH(t.c)}"
    title="${escH(_t(over?'d.kat_reczna':'d.kat_z_reguly'))}">${opts}</select>`;
}
const thCols=`<th>${escH(t('d.th_data'))}</th><th>${escH(t('d.th_opis'))}</th><th>${escH(t('d.th_kat'))}</th><th>${escH(t('d.th_tagi'))}</th><th class="num">${escH(t('d.th_kwota'))}</th>`;
const hdrTx=`<tr><th></th>${thCols}</tr>`;
function txRow(t){
  const r=isRefund(t);
  return `<tr class="txrow ${r?'refunded':''}" data-id="${enc(t.id)}">
    <td class="chk" title="${escH(_t('d.klik_zwrot'))}">${r?'↩︎':'○'}</td>
    <td>${escH(t.d)}</td><td title="${escH(zrPelna(zrOf(t)))}">${escH(t.o)}</td><td class="catcell">${catSelect(t)}</td>
    <td class="tagcell">${tagsOf(t).map(g=>isAutoTag(t,g)
      ? `<span class="ttag auto" data-tag="${enc(g)}" title="${escH(_t('d.tag_reg_title'))}">${escH(g.replace(/_/g,' '))}</span>`
      : `<span class="ttag" data-tag="${enc(g)}" title="${escH(_t('d.klik_zdejmij'))}">${escH(g.replace(/_/g,' '))}</span>`).join('')}<span class="tagadd" title="${escH(_t('d.dodaj_tag'))}">+🔖</span></td>
    <td class="num">${fmt(t.k)}</td></tr>`;
}
function bindTxRows(root){
  // klik w wiersz = zwrot; ale NIE gdy klikamy w dropdown kategorii
  root.querySelectorAll('.txrow').forEach(el=>el.onclick=e=>{
    if(e.target.closest('.catsel') || e.target.closest('.tagcell')) return;
    toggleRefund(dec(el.dataset.id));
  });
  root.querySelectorAll('.txrow .ttag.auto').forEach(el=>el.onclick=e=>{
    e.stopPropagation(); suppressAutoTag(dec(el.closest('.txrow').dataset.id), dec(el.dataset.tag));
  });
  root.querySelectorAll('.txrow .ttag:not(.auto)').forEach(el=>el.onclick=e=>{
    e.stopPropagation(); removeTag(dec(el.closest('.txrow').dataset.id), dec(el.dataset.tag));
  });
  root.querySelectorAll('.txrow .tagadd').forEach(el=>el.onclick=e=>{
    e.stopPropagation();
    const ist=allTags();
    const tag=normTag(prompt(ist.length?t('d.prompt_tag_ist',{lista:ist.join(', ')}):t('d.prompt_tag'), selTag||ist[ist.length-1]||''));
    if(tag) addTag([dec(el.closest('.txrow').dataset.id)], tag);
  });
  root.querySelectorAll('.catsel').forEach(sel=>{
    sel.onclick=e=>e.stopPropagation();
    sel.onchange=async e=>{
      e.stopPropagation();
      const id=dec(sel.dataset.id);
      if(sel.value==='__nowa__'){
        const nazwa=await dodajKategorie(prompt(t('d.prompt_nowa_kat'),''));
        if(!nazwa){ renderAll(); return; }      // anulowane — cofnij wybór w selekcie
        await setCat(id, nazwa, sel.dataset.orig);
        await proponujRegule(id, nazwa);
        return;
      }
      const kat=sel.value, orig=sel.dataset.orig;
      await setCat(id, kat, orig);
      if(kat && kat!==orig) await proponujRegule(id, kat);
    };
  });
}
function renderDrill(){
  const D=document.getElementById('drill');
  if(!selCat){D.innerHTML='';return;}
  // wszystkie transakcje EFEKTYWNIE w tej kategorii w okresie (uwzględnia override)
  const rows=DATA.out.filter(t=>inPeriod(t)&&effCat(t)===selCat).sort((a,b)=>b.k-a.k);
  const sum=rows.filter(t=>!isRefund(t)).reduce((s,t)=>s+t.k,0);
  const nref=rows.filter(isRefund).length;
  D.innerHTML=`<div class="drill">
    <div class="drill-head"><span class="t" style="color:${catColor(selCat)}">${escH(selCat.replace(/_/g,' '))}</span>
      <span class="s">${tH('d.n_tx',{n:rows.length})} · ${escH(I.kwota(sum,2))}${nref?` · ${tH('d.n_do_zwrotu',{n:nref})}`:''}</span></div>
    <div class="scroll"><table>${hdrTx}
    ${rows.map(txRow).join('')}</table></div>
    <div class="muted" style="font-size:12px;margin-top:8px">${escH(t('d.drill_foot'))}</div></div>`;
  bindTxRows(D);
}

function weeksSVG(){
  const rows=outRows(), m={};
  rows.forEach(t=>{const d=new Date(t.d);const on=new Date(d);on.setDate(d.getDate()-((d.getDay()+6)%7));
    const k=on.toISOString().slice(0,10);m[k]=(m[k]||0)+t.k;});
  const it=Object.entries(m).sort();
  if(!it.length)return `<div class="muted">${escH(t('d.brak_danych'))}</div>`;
  const mx=Math.max(...it.map(x=>x[1]))||1,W=Math.max(360,it.length*70),H=200,pad=30,bw=44;
  const gap=(W-2*pad)/it.length; let s='';
  it.forEach(([wk,v],i)=>{const h=v/mx*(H-60),x=pad+i*gap+(gap-bw)/2,y=H-30-h;
    s+=`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${bw}" height="${h.toFixed(0)}" rx="4" class="bar"><title>${tH('d.tydz_od',{wk,kwota:I.kwota(v,2)})}</title></rect>`
      +`<text x="${(x+bw/2).toFixed(0)}" y="${(y-5).toFixed(0)}" text-anchor="middle" class="bar-val">${fmt0(v)}</text>`
      +`<text x="${(x+bw/2).toFixed(0)}" y="${H-10}" text-anchor="middle" class="bar-lbl">${wk.slice(5)}</text>`;});
  return `<svg viewBox="0 0 ${W} ${H}" class="bars" style="min-width:${W}px">${s}</svg>`;
}
function renderWeeks(){document.getElementById('weeks-scope').textContent=period==='all'?t('d.caly_okres'):mLong(period);document.getElementById('weeks').innerHTML=`<div style="overflow-x:auto">${weeksSVG()}</div>`;}

function renderTop(){
  const rows=[...outRows()].sort((a,b)=>b.k-a.k).slice(0,12);
  document.getElementById('top-scope').textContent = period==='all'?t('d.caly_okres'):mLong(period);
  const T=document.getElementById('top');
  T.innerHTML=`<div class="scroll"><table>
    ${hdrTx}
    ${rows.map(txRow).join('')}</table></div>`;
  bindTxRows(T);
}

function renderRefunds(){
  const R=document.getElementById('refunds'), card=document.getElementById('refunds-card');
  const rows=refundRows().sort((a,b)=>b.k-a.k);
  const sum=rows.reduce((s,t)=>s+t.k,0);
  card.style.display = rows.length?'':'none';
  if(!rows.length){R.innerHTML='';return;}
  document.getElementById('refunds-sum').textContent = I.kwota(sum,2);
  R.innerHTML=`<div class="scroll"><table>
    ${hdrTx}
    ${rows.map(txRow).join('')}</table></div>
    <div class="muted" style="font-size:12px;margin-top:8px">${escH(t('d.zw_foot'))}</div>`;
  bindTxRows(R);
}

// #2 PORÓWNANIE MIESIĘCY — tabela kategoria × miesiąc (wszystkie miesiące, niezależne od zakładki)
function renderCompare(){
  const C=document.getElementById('compare');
  const ms=months;                                  // wszystkie miesiące z danych
  if(ms.length<2){ C.innerHTML=`<div class="muted">${escH(t('d.potrzeba_2'))}</div>`; return; }
  // suma per (kategoria, miesiąc), bez zwrotów
  const rows=DATA.out.filter(t=>!isRefund(t));
  const cats={}, mtot={};
  rows.forEach(t=>{const c=effCat(t),m=t.d.slice(0,7);
    (cats[c]=cats[c]||{})[m]=(cats[c][m]||0)+t.k; mtot[m]=(mtot[m]||0)+t.k;});
  // sortuj kategorie po sumie łącznej malejąco
  const order=Object.keys(cats).sort((a,b)=>
    Object.values(cats[b]).reduce((s,v)=>s+v,0)-Object.values(cats[a]).reduce((s,v)=>s+v,0));
  const LM=fullMonths.length>=2?fullMonths:ms;     // trend = ostatni PEŁNY miesiąc vs poprzedni
  const arrow=(cur,prev)=>{if(prev==null||prev===0)return '';const d=cur-prev;
    if(Math.abs(d)<Math.max(prev*0.05,5))return '<span class="flat">→</span>';
    return d>0?`<span class="up">▲ ${fmt0(d)}</span>`:`<span class="down">▼ ${fmt0(-d)}</span>`;};
  const head=`<tr><th>${escH(t('d.th_kat'))}</th>${ms.map(m=>`<th class="num">${mLbl(m)}</th>`).join('')}<th class="num">${escH(t('d.trend'))}</th></tr>`;
  const body=order.map(c=>{
    const cells=ms.map(m=>`<td class="num">${cats[c][m]?fmt0(cats[c][m]):'·'}</td>`).join('');
    const last=cats[c][LM[LM.length-1]]||0, prev=cats[c][LM[LM.length-2]]||0;
    return `<tr><td><span class="dot" style="display:inline-block;background:${catColor(c)}"></span> ${escH(c.replace(/_/g,' '))}</td>${cells}<td class="num">${arrow(last,prev)}</td></tr>`;
  }).join('');
  const totrow=`<tr class="totrow"><td>${escH(t('d.razem_caps'))}</td>${ms.map(m=>`<td class="num">${fmt0(mtot[m])}</td>`).join('')}<td class="num">${arrow(mtot[LM[LM.length-1]],mtot[LM[LM.length-2]])}</td></tr>`;
  C.innerHTML=`<div class="scroll"><table class="cmp">${head}${body}${totrow}</table></div>
    <div class="muted" style="font-size:12px;margin-top:8px">${escH(t('d.trend_foot'))}</div>`;
}

// #3 SUBSKRYPCJE / RACHUNKI CYKLICZNE — powtarzalne obciążenia (ten sam merchant, ≥2 miesiące)
function subKey(o){ // normalizacja merchanta: bez cyfr/miast, do wykrycia powtórek
  return o.toLowerCase().replace(/[0-9]/g,'').replace(/[^a-ząćęłńóśźż ]/g,' ')
          .split(',')[0].replace(/\s+/g,' ').trim().slice(0,22);
}
// kategorie uznawane za stały koszt cykliczny z definicji reguły
// (Ubezpieczenia pomijamy — polisy to zwykle jednorazowe/roczne, nie miesięczne subskrypcje)
const SUB_CATS=new Set(['Subskrypcje']);
function detectSubs(){
  const rows=DATA.out.filter(t=>!isRefund(t));
  const grp={};
  rows.forEach(t=>{const k=subKey(t.o); if(k.length<3)return; (grp[k]=grp[k]||[]).push(t);});
  const subs=[], seen=new Set();
  // sygnał 1: powtórka — ten sam merchant w ≥2 miesiącach, zbliżona kwota
  for(const k in grp){
    const g=grp[k], mset=new Set(g.map(t=>t.d.slice(0,7)));
    const ks=g.map(t=>t.k).sort((a,b)=>a-b), med=ks[Math.floor(ks.length/2)];
    const stab=g.filter(t=>Math.abs(t.k-med)<=Math.max(med*0.15,2)).length;
    if(mset.size>=2 && stab>=2){
      subs.push({name:g[0].o.split(',')[0].slice(0,32),med,mies:mset.size,cat:effCat(g[0]),src:'cykl'});
      seen.add(k);
    }
  }
  // sygnał 2: kategoria to stały koszt (subskrypcje/telekom/ubezpieczenia) — nawet jeśli raz w danych
  for(const k in grp){
    if(seen.has(k)) continue;
    const g=grp[k];
    if(!SUB_CATS.has(effCat(g[0])) && globalThis.W.reguly.rola(effCat(g[0]))!=='subskrypcje') continue;
    const ks=g.map(t=>t.k).sort((a,b)=>a-b), med=ks[Math.floor(ks.length/2)];
    const mset=new Set(g.map(t=>t.d.slice(0,7)));
    subs.push({name:g[0].o.split(',')[0].slice(0,32),med,mies:mset.size,cat:effCat(g[0]),src:'kat'});
  }
  return subs.sort((a,b)=>b.med-a.med);
}
function renderSubs(){
  const S=document.getElementById('subs');
  const subs=detectSubs();
  if(!subs.length){ S.innerHTML=`<div class="muted">${escH(t('d.brak_subs'))}</div>`; document.getElementById('subs-sum').textContent=''; return; }
  // koszt miesięczny: pozycje ≤60 zł traktuj jako miesięczne; większe (>100) prawdopodobnie roczne — nie sumuj do /mc
  const mies=subs.filter(x=>x.med<=60);
  const roczne=subs.filter(x=>x.med>60);
  const perMc=mies.reduce((s,x)=>s+x.med,0);
  document.getElementById('subs-sum').textContent='~'+I.kwota(perMc)+t('d.na_mc');
  const badge=s=>`<span class="tag" style="margin:0">${escH(t(s==='cykl'?'d.sub_cykl':'d.sub_kat'))}</span>`;
  const row=x=>`<tr><td>${escH(x.name)}</td><td><span class="dot" style="display:inline-block;background:${catColor(x.cat)}"></span> ${escH(x.cat.replace(/_/g,' '))}</td>
      <td class="num">${fmt(x.med)}</td><td>${badge(x.src)}</td></tr>`;
  S.innerHTML=`<div class="scroll"><table>
    <tr><th>${escH(t('d.th_merchant'))}</th><th>${escH(t('d.th_kat'))}</th><th class="num">${escH(t('d.th_kwota'))}</th><th>${escH(t('d.th_sygnal'))}</th></tr>
    ${mies.map(row).join('')}
    ${roczne.length?`<tr class="totrow"><td colspan="4" class="muted" style="font-weight:400">${escH(t('d.sub_roczne',{sym:I.symbol()}))}</td></tr>`:''}
    ${roczne.map(row).join('')}</table></div>
    <div class="muted" style="font-size:12px;margin-top:8px">
      ${tH('d.sub_foot',{sym:I.symbol(),limit:I.kwota(60),k50:I.kwota(50),kap:fmtM(15000)})}</div>`;
}

// #3 ZARZĄDZANIE KATEGORIAMI — własne (dodane tu) obok tych z reguł kategorie.yaml
function renderKategorie(){
  const K=document.getElementById('kategorie'); if(!K) return;
  // ile transakcji (w całym zbiorze, nie tylko w okresie) siedzi w danej kategorii
  const licz={}; DATA.out.forEach(t=>{const c=effCat(t);licz[c]=(licz[c]||0)+1;});
  const zReg=(DATA.kategorie||[]);
  const chip=(c,wl)=>`<span class="chip ${wl?'':'rule'}" style="border-left:3px solid ${catColor(c)}">
      ${escH(c.replace(/_/g,' '))}<span class="n">${licz[c]||0}</span>
      ${wl?`<span class="x" data-del="${enc(c)}" title="${escH(t('d.usun_kat_title'))}">×</span>`:''}</span>`;
  K.innerHTML=`
    <div class="muted" style="font-size:12px">${escH(t('d.kat_wlasne_opis'))}</div>
    <div class="chips">${wlasne.length?sortCats(wlasne).map(c=>chip(c,true)).join(''):`<span class="muted" style="font-size:12px">${escH(t('d.brak_dodaj'))}</span>`}</div>
    <div class="addcat">
      <input id="cat-new" type="text" placeholder="${escH(t('d.ph_prezenty'))}" maxlength="40">
      <button class="tab" id="cat-add">${escH(t('d.dodaj_kat'))}</button>
    </div>
    <div class="muted" style="font-size:12px;margin-top:14px">${tH('d.kat_z_regul_opis')}</div>
    <div class="chips">${sortCats(zReg).map(c=>chip(c,false)).join('')}</div>`;
  const add=async()=>{
    const inp=document.getElementById('cat-new');
    const nazwa=await dodajKategorie(inp.value);
    if(nazwa){ inp.value=''; renderAll(); }
  };
  document.getElementById('cat-add').onclick=add;
  document.getElementById('cat-new').onkeydown=e=>{ if(e.key==='Enter') add(); };
  K.querySelectorAll('.chip .x').forEach(el=>el.onclick=()=>usunKategorie(dec(el.dataset.del)));
}

// REGUŁY — własne (z aplikacji) + pobranie kategorie.yaml do edycji
const naglYaml=()=>t('d.nagl_yaml');
function renderReguly(){
  const E=document.getElementById('reguly'); if(!E) return;
  const wiersze=reguly.map((r,i)=>{ const test=testerWzorca(r.wzorzec), n=test?DATA.out.filter(test).length:0;
    return `<tr><td><code>${escH(odWzorca(r.wzorzec))}</code></td><td><span class="dot" style="display:inline-block;background:${catColor(r.kategoria)}"></span> ${escH(r.kategoria.replace(/_/g,' '))}</td>
      <td class="num">${n}</td><td><span class="tagadd reg-del" data-i="${i}" title="${escH(t('d.usun_regule_title'))}">🗑</span></td></tr>`; }).join('');
  E.innerHTML=`<div class="muted" style="font-size:12px">${escH(t('d.reguly_opis'))}</div>
    ${reguly.length?`<div class="scroll"><table><tr><th>${escH(t('d.th_fragment'))}</th><th>${escH(t('d.th_kat'))}</th><th class="num">${escH(t('d.th_transakcji'))}</th><th></th></tr>${wiersze}</table></div>`
      :`<div class="muted" style="font-size:12px;margin:8px 0">${escH(t('d.brak_regul'))}</div>`}
    <div class="addcat" style="margin-top:8px">
      <input id="reg-wz" placeholder="${escH(t('d.ph_regula'))}" maxlength="200" style="min-width:180px">
      <select id="reg-kat" class="catsel" style="max-width:220px">${catList().map(c=>`<option value="${escH(c)}">${escH(c.replace(/_/g,' '))}</option>`).join('')}</select>
      <button class="tab" id="reg-add">${escH(t('d.dodaj_regule'))}</button></div>
    <div class="muted" style="font-size:12px;margin-top:12px">${escH(t('d.reg_z_pliku'))}${DATA.reguly_z_pliku?tH('d.reg_plik_user'):escH(t('d.reg_plik_wbud'))}
      · <button class="lnk" id="reg-pobierz">${escH(t('d.reg_pobierz'))}</button></div>`;
  E.querySelectorAll('.reg-del').forEach(el=>el.onclick=()=>usunRegule(+el.dataset.i));
  document.getElementById('reg-add').onclick=async()=>{
    const tekst=document.getElementById('reg-wz').value, kat=document.getElementById('reg-kat').value;
    const test=testerWzorca(naWzorzec(tekst));
    if(!tekst.trim()||!test){ alert(t('d.podaj_fragment')); return; }
    const n=DATA.out.filter(test).length;
    if(!confirm(t('d.regula_obejmie',{tekst:tekst.trim(),kat:kat.replace(/_/g,' '),n}))) return;
    await dodajRegule(tekst, kat);
  };
  document.getElementById('reg-pobierz').onclick=()=>{
    const y=DATA.reguly_yaml||'';
    const pierwsze=['pl','en'].map(j=>String(globalThis.W.i18n.SLOWNIK[j]['d.nagl_yaml']).split('\n')[0]);   // nagłówek w dowolnym języku = już jest
    globalThis.W.pobierz('kategorie.yaml', pierwsze.some(l=>y.startsWith(l))?y:naglYaml()+y);
  };
}

// USTAWIENIA FIRE — konfiguracja.json (puste pole = wartość domyślna)
function renderUstawienia(){
  const E=document.getElementById('ustawienia-fire'); if(!E) return;
  const v=(k,d)=>konf[k]!==undefined?konf[k]:d;
  const jez=konf.jezyk||I.jezyk();
  E.innerHTML=`<div class="muted" style="font-size:12px">${escH(t('d.u_opis'))}</div>
    <div class="form-ust">
      <label>${escH(t('d.u_jezyk'))}<select id="u-jezyk"><option value="pl"${jez==='pl'?' selected':''}>Polski</option><option value="en"${jez==='en'?' selected':''}>English</option></select></label>
      <label>${escH(t('d.u_waluta'))}<input id="u-waluta" maxlength="3" pattern="[A-Za-z]{3}" style="text-transform:uppercase" value="${escH(konf.waluta||'')}" placeholder="${escH(t('d.u_waluta_auto',{waluta:DATA.waluta||'PLN'}))}"></label>
      <label>${escH(t('d.u_cel',{sym:I.symbol()}))}<input id="u-cel" type="number" min="0" step="100" value="${+v('fire_cel_mc',5000)}"></label>
      <label>${escH(t('d.u_swr'))}<input id="u-swr" type="number" min="0.5" max="20" step="0.1" value="${+(v('fire_swr',0.04)*100).toFixed(2)}"></label>
      <label>${escH(t('d.u_jedn',{sym:I.symbol()}))}<input id="u-jedn" type="number" min="0" step="50" value="${+v('prog_jednorazowych',300)}"></label>
      <label>${escH(t('d.u_n'))}<input id="u-n" type="number" min="1" max="36" step="1" value="${+v('miesiecy_podsumowania',4)}"></label>
      <label>${escH(t('d.u_dzieci'))}<input id="u-dzieci" maxlength="400" value="${escH(v('tagi_dzieci',CFG.syn).join(', '))}"></label>
      <label>${escH(t('d.u_wyd'))}<input id="u-wyd" maxlength="400" value="${escH(v('tagi_wydarzen',[]).join(', '))}"></label>
    </div>
    <button class="tab" id="u-zapisz">${escH(t('d.u_zapisz'))}</button>`;
  document.getElementById('u-zapisz').onclick=async()=>{
    const val=id=>document.getElementById(id).value.trim(), lista=id=>val(id).split(',').map(x=>x.trim()).filter(Boolean);
    const k=konf.nazwy_zrodel?{nazwy_zrodel:konf.nazwy_zrodel}:{};   // nazwy kart zapisuje osobny formularz
    k.jezyk=document.getElementById('u-jezyk').value;
    const wal=val('u-waluta').toUpperCase(); if(wal) k.waluta=wal;          // puste = autodetekcja z plików
    // bez kategorie.yaml zmiana języka zmienia nazwy kategorii domyślnych — ręczne zmiany zostają przy starych
    const reczne=Object.keys(overrides).length||budzety.length||wlasne.length||reguly.length;
    if(k.jezyk!==I.jezyk() && !DATA.reguly_z_pliku && reczne && !confirm(t('d.zmiana_jezyka'))) return;
    const liczba=(id,klucz,mn=1)=>{ if(val(id)!=='') k[klucz]=Number(val(id))*mn; };
    liczba('u-cel','fire_cel_mc'); liczba('u-swr','fire_swr',0.01); liczba('u-jedn','prog_jednorazowych'); liczba('u-n','miesiecy_podsumowania');
    if(k.fire_swr!==undefined) k.fire_swr=Math.round(k.fire_swr*10000)/10000;
    k.tagi_dzieci=lista('u-dzieci'); k.tagi_wydarzen=lista('u-wyd');
    if(await zapiszUst('/api/konfiguracja',k,t('d.co_ustawienia'))){ konf=k; I.ustaw(k.jezyk); wPrzeladuj(); }
  };
}

// KARTY I RACHUNKI — własne nazwy źródeł (konfiguracja.json → nazwy_zrodel)
function renderUstZrodla(){
  const E=document.getElementById('ustawienia-zrodla'); if(!E) return;
  const zs=[...new Set(DATA.out.map(zrOf))].filter(z=>z.includes(':'))
    .sort((a,b)=>BANK_ORDER.indexOf(zrBank(a))-BANK_ORDER.indexOf(zrBank(b))||(a<b?-1:a>b?1:0));
  if(!zs.length){ E.replaceChildren(h('div',{class:'muted'},t('d.zr_brak_nr'))); return; }
  const N=nazwyZr();
  const pola=zs.map(z=>h('input',{'data-zr':z,maxLength:40,value:N[z]||'',placeholder:zrDomyslna(z)}));
  const btn=h('button',{class:'tab',id:'zr-zapisz'},t('d.zapisz_nazwy'));
  E.replaceChildren(
    h('div',{class:'muted',style:'font-size:12px'},t('d.zr_opis')),
    h('div',{class:'form-ust'},zs.map((z,i)=>h('label',{},bankNazwa(zrBank(z))+' · '+zrDomyslna(z),pola[i]))), btn);
  btn.onclick=async()=>{
    const m={};
    for(const inp of pola){
      const v=inp.value.trim(); if(!v) continue;
      if(!NAZWA_OK.test(v)){ alert(t('d.nazwa_zr_zla',{nazwa:v})); return; }
      m[inp.dataset.zr]=v;
    }
    const k=Object.assign({},konf,{nazwy_zrodel:m});
    if(await zapiszUst('/api/konfiguracja',k,t('d.co_nazwy_kart'))){ konf=k; renderAll(); }
  };
}

// TAGI — podsumowanie per tag + szczegóły + tagowanie hurtem (zakres dat + filtr opisu)
function renderTagi(){
  const G=document.getElementById('tagi'); if(!G) return;
  const rowsOf=tag=>DATA.out.filter(t=>tagsOf(t).includes(tag) && inTagPer(t));
  const tags=allTags().filter(g=>rowsOf(g).length);          // tylko tagi z transakcjami w wybranym okresie
  const perOpts=[['all',t('d.caly_okres_cap')],['tab',t('d.jak_zakladka_mies')],...months.slice().reverse().map(m=>[m,mLbl(m)]),['range',t('d.wlasny_zakres')]]
    .map(([v,l])=>`<option value="${v}" ${tagPer.mode===v?'selected':''}>${escH(l)}</option>`).join('');
  const perBar=`<div class="addcat" style="margin:0 0 10px">
      <span class="muted" style="font-size:12px">${escH(t('d.okres_dp'))}</span>
      <select id="tag-per" class="catsel" style="max-width:none">${perOpts}</select>
      ${tagPer.mode==='range'?`<input id="tag-od" type="date" value="${tagPer.od}" style="min-width:0">
        <input id="tag-do" type="date" value="${tagPer.do}" style="min-width:0">`:''}
      <span class="tag" style="margin:0">${escH(tagPerLabel())}</span></div>`;
  const stat=tag=>{ const r=rowsOf(tag), licz=r.filter(t=>!isRefund(t)), ds=r.map(t=>t.d).sort();
    return {r, sum:licz.reduce((s,t)=>s+t.k,0), od:ds[0], do:ds[ds.length-1]}; };
  const summary = tags.length ? `<div class="scroll"><table>
    <tr><th>${escH(t('d.th_tag'))}</th><th>${escH(t('d.th_okres'))}</th><th class="num">${escH(t('d.th_transakcji'))}</th><th class="num">${escH(t('d.th_suma'))}</th></tr>
    ${tags.map(g=>{const x=stat(g); return `<tr class="tagrow ${selTag===g?'sel':''}" data-tag="${enc(g)}">
      <td><span class="chev">${selTag===g?'▾':'▸'}</span> <b>${escH(g.replace(/_/g,' '))}</b></td><td>${escH(x.od)} → ${escH(x.do)}</td>
      <td class="num">${x.r.length}</td><td class="num">${escH(I.kwota(x.sum,2))}</td></tr>`;}).join('')}</table></div>`
    : (allTags().length ? `<div class="muted" style="font-size:12px">${tH('d.brak_otag_okres',{okres:tagPerLabel()})}</div>`
       : `<div class="muted" style="font-size:12px">${escH(t('d.brak_tagow'))}</div>`);

  let detail='';
  if(selTag && tags.includes(selTag)){
    const x=stat(selTag), cats={};
    x.r.filter(t=>!isRefund(t)).forEach(t=>cats[effCat(t)]=(cats[effCat(t)]||0)+t.k);
    // dni z wydatkami, nie rozpiętość dat — lot kupiony z wyprzedzeniem nie rozmywa zł/dzień
    const dni=new Set(x.r.filter(t=>!isRefund(t)).map(t=>t.d)).size||1;
    detail=`<div class="drill"><div class="drill-head"><span class="t">🔖 ${escH(selTag.replace(/_/g,' '))}</span>
        <span class="s">${tH('d.n_tx',{n:x.r.length})} · <b>${escH(I.kwota(x.sum,2))}</b> · ${tH('d.dni_z_wyd',{n:dni})} · ${escH(I.kwota(x.sum/dni))}${escH(t('d.na_dzien'))}</span></div>
      ${(()=>{ const pm={}; x.r.filter(t=>!isRefund(t)).forEach(t=>pm[t.d.slice(0,7)]=(pm[t.d.slice(0,7)]||0)+t.k);
          const ks=Object.keys(pm).sort(); return ks.length>1 ? `<div class="chips">${ks.map(m=>
          `<span class="chip">📅 ${mLbl(m)}<span class="n">${escH(I.kwota(pm[m],2))}</span></span>`).join('')}</div>` : ''; })()}
      <div class="chips">${Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>
        `<span class="chip" style="border-left:3px solid ${catColor(c)}">${escH(c.replace(/_/g,' '))}<span class="n">${escH(I.kwota(v,2))} · ${Math.round(100*v/(x.sum||1))}%</span></span>`).join('')}</div>
      <div class="scroll"><table>${hdrTx}${x.r.sort((a,b)=>a.d<b.d?-1:1).map(txRow).join('')}</table></div>
      <div class="muted" style="font-size:12px;margin-top:8px">${escH(t('d.tag_foot'))}
        <span class="tagadd" id="tag-del" style="margin-left:8px">${tH('d.usun_tag_wszystkie',{tag:selTag.replace(/_/g,' ')})}</span></div></div>`;
  }

  const esc=escH;
  let prev='';
  if(bulk.preview){
    const sumChk=bulk.preview.filter(t=>bulk.checked.has(t.id)).reduce((s,t)=>s+t.k,0);
    prev=`<div class="scroll" style="margin-top:10px"><table>
      <tr><th><input type="checkbox" id="bulk-all" ${bulk.checked.size===bulk.preview.length?'checked':''}></th>${thCols}</tr>
      ${bulk.preview.map(t=>`<tr><td><input type="checkbox" class="bulk-chk" data-id="${enc(t.id)}" ${bulk.checked.has(t.id)?'checked':''}></td>
        <td>${escH(t.d)}</td><td>${escH(t.o)}</td><td>${escH(effCat(t).replace(/_/g,' '))}</td><td>${escH(tagsOf(t).join(', ').replace(/_/g,' '))}</td><td class="num">${fmt(t.k)}</td></tr>`).join('')}
      </table></div>
      <div class="addcat" style="margin-top:8px"><button class="tab" id="bulk-save">${tH('d.bulk_save',{n:bulk.checked.size,kwota:I.kwota(sumChk,2)})}</button>
        <button class="tab" id="bulk-cancel">${escH(t('d.anuluj'))}</button></div>`;
  }
  G.innerHTML=`${perBar}${summary}${detail}
    <div class="muted" style="font-size:12px;margin-top:16px">${tH('d.bulk_opis')}</div>
    <div class="addcat">
      <input id="bulk-tag" list="bulk-tags" placeholder="${escH(t('d.ph_bulk_tag'))}" maxlength="40" value="${esc(bulk.tag)}" style="min-width:180px">
      <datalist id="bulk-tags">${tags.map(g=>`<option value="${escH(g)}">`).join('')}</datalist>
      <input id="bulk-od" type="date" value="${bulk.od}" style="min-width:0">
      <input id="bulk-do" type="date" value="${bulk.do}" style="min-width:0">
      <input id="bulk-f" placeholder="${escH(t('d.ph_bulk_f'))}" value="${esc(bulk.f)}" style="min-width:160px">
      <button class="tab" id="bulk-show">${escH(t('d.bulk_show'))}</button>
    </div>${prev}`;

  G.querySelectorAll('.tagrow').forEach(el=>el.onclick=()=>{const g=dec(el.dataset.tag);selTag=(selTag===g?null:g);renderTagi();});
  const savePer=()=>{ try{ localStorage.setItem('wydatki_tagi_okres_v1', JSON.stringify(tagPer)); }catch(e){} renderTagi(); };
  document.getElementById('tag-per').onchange=e=>{ tagPer.mode=e.target.value; savePer(); };
  ['od','do'].forEach(k=>{ const el=document.getElementById('tag-'+k); if(el) el.onchange=()=>{ tagPer[k]=el.value; savePer(); }; });
  const del=document.getElementById('tag-del'); if(del) del.onclick=()=>deleteTagAll(selTag);
  if(detail) bindTxRows(G.querySelector('.drill'));
  const val=id=>document.getElementById(id).value;
  ['bulk-tag','bulk-od','bulk-do','bulk-f'].forEach(id=>document.getElementById(id).oninput=()=>{
    bulk.tag=val('bulk-tag'); bulk.od=val('bulk-od'); bulk.do=val('bulk-do'); bulk.f=val('bulk-f'); });
  document.getElementById('bulk-show').onclick=()=>{
    if(!bulk.od){ alert(t('d.podaj_date')); return; }
    const od=bulk.od, dd=bulk.do||bulk.od;
    let rx=null; if(bulk.f.trim()){
      const ryz=globalThis.W.reguly&&globalThis.W.reguly.ryzykowny(bulk.f.trim()); if(ryz){ alert(t('d.filtr_odrzucony',{powod:ryz})); return; }   // ReDoS
      try{ rx=new RegExp(bulk.f.trim(),'i'); }catch(e){ alert(t('d.filtr_zly',{blad:e.message})); return; } }
    bulk.preview=DATA.out.filter(t=>t.d>=od && t.d<=dd && (!rx || rx.test(t.o))).sort((a,b)=>a.d<b.d?-1:1);
    bulk.checked=new Set(bulk.preview.map(t=>t.id));
    renderTagi();
  };
  if(bulk.preview){
    G.querySelectorAll('.bulk-chk').forEach(el=>el.onchange=()=>{const id=dec(el.dataset.id);
      el.checked?bulk.checked.add(id):bulk.checked.delete(id); renderTagi();});
    document.getElementById('bulk-all').onchange=e=>{bulk.checked=e.target.checked?new Set(bulk.preview.map(t=>t.id)):new Set(); renderTagi();};
    document.getElementById('bulk-cancel').onclick=()=>{bulk.preview=null; renderTagi();};
    document.getElementById('bulk-save').onclick=async()=>{
      const tag=normTag(bulk.tag); if(!tag) { if(!bulk.tag.trim()) alert(t('d.podaj_tag')); return; }
      if(!bulk.checked.size){ alert(t('d.nic_zazn')); return; }
      const ids=[...bulk.checked]; bulk.preview=null; selTag=tag;
      await addTag(ids, tag);
    };
  }
}

// BUDŻETY — okres: wybrana zakładka miesiąca, a przy „Cały okres" bieżący miesiąc/rok
function budRef(){
  const now=new Date(), cur=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  return period==='all' ? cur : period;
}
function budOkres(b){
  const ref=budRef(), now=new Date(), cur=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  if(b.okres==='rok'){
    const y=ref.slice(0,4), isCur=(+y===now.getFullYear());
    const frac=isCur ? ((now-new Date(+y,0,1))/864e5+1)/(((+y%4===0)?366:365)) : (+y<now.getFullYear()?1:0);
    return {klucz:y, label:y, frac};
  }
  const [y,m]=ref.split('-').map(Number), dim=new Date(y,m,0).getDate();
  const frac = ref===cur ? now.getDate()/dim : (ref<cur?1:0);
  return {klucz:ref, label:mLbl(ref), frac};
}
function budMatch(t,b){
  const g=tagsOf(t);
  return ((b.kategorie||[]).includes(effCat(t)) || g.some(x=>(b.tagi||[]).includes(x)))
         && !g.some(x=>(b.bez_tagow||[]).includes(x)) && !isRefund(t);
}
function budStan(b){
  const o=budOkres(b), limit=+((b.wyjatki||{})[o.klucz] ?? b.limit) || 0;
  const rows=DATA.out.filter(t=>t.d.startsWith(o.klucz) && budMatch(t,b));
  const wyd=rows.reduce((s,t)=>s+t.k,0);
  const prog = o.frac>0.15 && o.frac<1 ? wyd/o.frac : wyd;          // prognoza na koniec okresu (od ~15% okresu)
  return {o, limit, rows, wyd, prog};
}
function renderBudzety(){
  const B=document.getElementById('budzety'); if(!B) return;
  document.getElementById('bud-scope').textContent = period==='all' ? t('d.bud_biezacy') : t('d.wg_zakladki',{m:mLbl(period)});
  const zakres=b=>[...(b.kategorie||[]).map(c=>escH(c.replace(/_/g,' '))), ...(b.tagi||[]).map(g=>'🔖'+escH(g.replace(/_/g,' ')))].join(' + ')
                  + ((b.bez_tagow||[]).length?tH('d.bez_tagow',{tagi:b.bez_tagow.join(', ')}):'');
  const rowsHtml = budzety.map((b,i)=>{
    const x=budStan(b), pct=x.limit?x.wyd/x.limit:0;
    const cls = x.wyd>x.limit ? 'over' : (x.prog>x.limit || pct>0.8 ? 'warn' : 'ok');
    const col = {ok:'#2e9e5b',warn:'#e8a33d',over:'#e15759'}[cls];
    const wyj = (b.wyjatki||{})[x.o.klucz]!=null;
    return `<div class="bud ${selBud===i?'sel':''}" data-i="${i}">
      <div class="bud-top"><span class="bud-name">${escH(b.nazwa)}</span>
        <span class="bud-val"><b class="${cls}">${fmt0(x.wyd)}</b> / ${escH(I.kwota(x.limit))} · ${x.o.label}</span></div>
      <div class="bud-bar"><div class="bud-fill" style="width:${Math.min(100,pct*100).toFixed(1)}%;background:${col}"></div>
        ${x.o.frac>0&&x.o.frac<1?`<div class="bud-pace" style="left:${(x.o.frac*100).toFixed(1)}%" title="${escH(t('d.tempo_title'))}"></div>`:''}</div>
      <div class="bud-sub"><span>${zakres(b)}</span>
        <span>${x.limit-x.wyd>=0?tH('d.zostalo',{kwota:I.kwota(x.limit-x.wyd)}):'<span class="over">'+tH('d.przekroczone',{kwota:I.kwota(x.wyd-x.limit)})+'</span>'}</span>
        ${x.o.frac>0.15&&x.o.frac<1?`<span class="${x.prog>x.limit?'warn':''}">${tH('d.prognoza',{kwota:I.kwota(x.prog)})}</span>`:''}
        <span>${escH(t(b.okres==='rok'?'d.limit_roczny':'d.limit_mies'))}${wyj?tH('d.wyjatek',{okres:x.o.label}):''}: <input type="number" min="0" step="50" class="bud-lim" data-i="${i}" value="${x.limit}" title="${escH(t(wyj?'d.zmiana_wyjatek':'d.zmiana_limit'))}"></span>
        <span class="tagadd bud-del" data-i="${i}" title="${escH(t('d.usun_bud_title'))}">🗑</span></div>
      ${selBud===i?`<div class="drill" style="margin-top:8px"><div class="scroll"><table>${hdrTx}${x.rows.slice().sort((a,b)=>b.k-a.k).map(txRow).join('')}</table></div></div>`:''}
    </div>`;}).join('');
  const opts=`<optgroup label="${escH(t('d.grp_kat'))}">${catList().map(c=>`<option value="k:${escH(c)}">${escH(c.replace(/_/g,' '))}</option>`).join('')}</optgroup>
    <optgroup label="${escH(t('d.grp_tagi'))}">${allTags().map(g=>`<option value="t:${escH(g)}">🔖 ${escH(g.replace(/_/g,' '))}</option>`).join('')}</optgroup>`;
  B.innerHTML=(rowsHtml||`<div class="muted" style="font-size:12px">${escH(t('d.brak_bud'))}</div>`)+`
    <div class="addcat" style="margin-top:12px">
      <input id="bud-n" placeholder="${escH(t('d.ph_bud_n'))}" maxlength="60" style="min-width:180px">
      <select id="bud-z" class="catsel" style="max-width:220px">${opts}</select>
      <select id="bud-o" class="catsel"><option value="miesiac">${escH(t('d.miesieczny'))}</option><option value="rok">${escH(t('d.roczny'))}</option></select>
      <input id="bud-l" type="number" min="0" step="50" placeholder="${escH(t('d.ph_limit',{sym:I.symbol()}))}" style="min-width:0;width:110px">
      <button class="tab" id="bud-add">${escH(t('d.dodaj_bud'))}</button></div>
    <div class="muted" style="font-size:12px;margin-top:6px">${tH('d.bud_foot')}</div>`;
  B.querySelectorAll('.bud').forEach(el=>el.onclick=e=>{
    if(e.target.closest('input,.bud-del,.drill')) return;
    const i=+el.dataset.i; selBud=(selBud===i?null:i); renderBudzety();
  });
  B.querySelectorAll('.bud-lim').forEach(el=>{ el.onclick=e=>e.stopPropagation(); el.onchange=async()=>{
    const b=budzety[+el.dataset.i], v=Math.max(0,+el.value||0), k=budOkres(b).klucz;
    if((b.wyjatki||{})[k]!=null) b.wyjatki[k]=v; else b.limit=v;
    await saveBudzety(); renderBudzety(); }; });
  B.querySelectorAll('.bud-del').forEach(el=>el.onclick=async e=>{ e.stopPropagation();
    const b=budzety[+el.dataset.i]; if(!confirm(t('d.usun_bud',{nazwa:b.nazwa}))) return;
    budzety.splice(+el.dataset.i,1); selBud=null; await saveBudzety(); renderBudzety(); });
  if(selBud!=null){ const d=B.querySelector('.bud.sel .drill'); if(d) bindTxRows(d); }
  document.getElementById('bud-add').onclick=async()=>{
    const n=document.getElementById('bud-n').value.trim(), z=document.getElementById('bud-z').value,
          o=document.getElementById('bud-o').value, l=+document.getElementById('bud-l').value;
    if(!n||!(l>0)){ alert(t('d.podaj_bud')); return; }
    const b={nazwa:n, okres:o, limit:l, kategorie:[], tagi:[]};
    (z[0]==='k'?b.kategorie:b.tagi).push(z.slice(2));
    budzety.push(b); await saveBudzety(); renderBudzety();
  };
}

// WPŁYWY DODATKOWE — grupy z _wplywy (kategorie.yaml) × miesiące, suma roczna, śr./mc
let selWpl=null;
function renderWplywy(){
  const W=document.getElementById('wplywy'); if(!W) return;
  const rows=DATA.in, rok=String(new Date().getFullYear());
  // wszystkie grupy z reguł (też puste — widać, że np. cashbacku brak w danych) + ewentualne inne
  const grp=[...new Set([...(DATA.wplywy_grupy||[]), ...rows.map(t=>t.g)])];
  const ms=months, sum=(g,f)=>rows.filter(t=>t.g===g&&f(t)).reduce((s,t)=>s+t.k,0);
  // średnia z ostatnich 4 pełnych miesięcy (jak PODSUMOWANIE.md) — wcześniejsze miesiące mają niepełne źródła
  const now=new Date(), cur=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const pelne=ms.filter(m=>m<cur).slice(-4);
  const head=`<tr><th>${escH(t('d.th_grupa'))}</th>${ms.map(m=>`<th class="num">${mLbl(m)}</th>`).join('')}<th class="num" title="${tH('d.srednia_z_pelnych',{n:pelne.length})}">${escH(t('d.sr_mc_star'))}</th><th class="num">${escH(t('d.rok_n',{rok}))}</th></tr>`;
  const body=grp.map(g=>{const per=ms.map(m=>sum(g,t=>t.d.startsWith(m)));
    const sr=pelne.reduce((s,m)=>s+sum(g,t=>t.d.startsWith(m)),0)/(pelne.length||1);
    return `<tr class="tagrow ${selWpl===g?'sel':''}" data-g="${enc(g)}"><td>${selWpl===g?'▾':'▸'} ${escH(g.replace(/_/g,' '))}</td>
      ${per.map(v=>`<td class="num">${v?fmt0(v):'·'}</td>`).join('')}
      <td class="num">${fmt0(sr)}</td><td class="num"><b>${fmt0(sum(g,t=>t.d.startsWith(rok)))}</b></td></tr>`;}).join('');
  // „zwroty/cashback" = grupy Cashback* i Zwroty* (bez prezentów od rodziny i innych wpływów)
  const zw=grp.filter(g=>/^(cashback|zwrot|refund)/i.test(g)).reduce((s,g)=>s+sum(g,t=>t.d.startsWith(rok)),0);
  document.getElementById('wpl-sum').textContent=t('d.wpl_sum',{rok,kwota:I.kwota(zw)});
  let det='';
  if(selWpl){ const r=rows.filter(t=>t.g===selWpl).sort((a,b)=>a.d<b.d?1:-1);
    det=`<div class="drill"><div class="scroll"><table><tr><th>${escH(t('d.th_data'))}</th><th>${escH(t('d.th_opis'))}</th><th class="num">${escH(t('d.th_kwota'))}</th></tr>
      ${r.map(t=>`<tr><td>${escH(t.d)}</td><td>${escH(t.o)}</td><td class="num">${fmt(t.k)}</td></tr>`).join('')}</table></div></div>`; }
  W.innerHTML=`<div class="scroll"><table class="cmp">${head}${body}</table></div>${det}
    <div class="muted" style="font-size:12px;margin-top:8px">${tH('d.wpl_foot',{n:pelne.length})}</div>`;
  W.querySelectorAll('.tagrow').forEach(el=>el.onclick=()=>{const g=dec(el.dataset.g);selWpl=(selWpl===g?null:g);renderWplywy();});
}

function renderAll(){renderTabs();renderKpis();renderFire();renderPace();renderBudzety();renderDonut();renderZrodla();renderDrill();renderWeeks();renderTop();renderTxList();renderRefunds();renderMonthsChart();renderCompare();renderWplywy();renderSubs();renderTagi();renderKategorie();renderReguly();renderUstawienia();renderUstZrodla();}

async function przelicz(){
  const b=document.getElementById('btn-przelicz'); if(b){b.disabled=true;b.textContent=t('d.przeliczam');}
  try{ const r=await wApi('/api/przelicz',{method:'POST'});
       if(!r.ok) throw new Error(await r.text());
       wPrzeladuj();
  }catch(e){ alert(t('d.blad_przeliczania',{blad:e.message})); if(b){b.disabled=false;b.textContent=t('d.przelicz');} }
}

(async()=>{
  await loadRefunds();
  await loadOverrides();
  await loadWlasne();
  await loadTagi();
  await loadBudzety();
  await loadReguly();
  await loadKonf();
  renderAll();
  const b=document.getElementById('btn-przelicz');
  if(b && SERVER){ b.style.display=''; b.onclick=przelicz; }
})();
};
