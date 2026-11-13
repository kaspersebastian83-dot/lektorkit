/* LEKTOR-APP – Ordner lesen, Bericht zeigen, Befunde, „Ist so gewollt“, Prüfprotokoll.
   Geschrieben wird nur die eigene Datei: Spektron-Projekt → _Spektron/LektorKit/_LektorKit.json, Projekt vor Spektron →
   Mitteilungen/_LektorKit.json (nie einen „_Spektron“-Ordner in einem alten Projekt anlegen). Alles andere wird nur gelesen. */
(function(){
'use strict';
const SO = window.SpektronOrdner, A = window.ArchivAuswertung, R = window.LektorRegeln, K = window.LektorKern;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tidy = A.tidy;
const DATEI = '_LektorKit.json', FORMAT = 'spektron-lektorkit';
const S = { lesenLauf: 0, oeffnenLauf: 0, andereLauf: 0, archiv: null, dir: null, daten: null, bericht: null, doc: null, erg: null, gewaehlt: null, andere: null, andereStatus: '', gewollt: [], gewolltFehler: '', gelesenAm: null };
$('version').textContent = ' ' + K.VERSION;

/* ---------- Ordner ---------- */
const gleichName = (a, b) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
async function unterordner(dir, name){
  if (!dir) return null;
  try{ return await dir.getDirectoryHandle(name); }catch(e){}
  try{ for await (const h of dir.values()) if (h.kind === 'directory' && gleichName(h.name, name)) return h; }catch(e){}
  return null;
}
async function dateiLesen(dir, name){ if (!dir) return null; try{ const f = await (await dir.getFileHandle(name)).getFile(); return { file: f, text: await f.text() }; }catch(e){ return null; } }
const jsonVon = t => JSON.parse(String(t).replace(/^﻿/, ''));

async function projektLesen(dir){
  const name = dir.name, nr = SO.projektNr(name), D = { projekt: { name, nr }, hinweise: [] };
  try{ const o = await SO.ort(dir, 'projekt'); const j = await dateiLesen(o.dir, '_Projekt.json'); D.pj = j ? jsonVon(j.text) : null;
    if (!j) D.hinweise.push('Keine Projektdaten (_Projekt.json) – Datum, Adresse und Schaden-Nr. sind nicht prüfbar.'); }
  catch(e){ D.pj = null; D.hinweise.push('Projektdaten nicht lesbar: ' + e.message); }
  let lkDir = null;
  try{ const o = await SO.ort(dir, 'labelkit'); lkDir = o.dir;
    if (o.dir){ const w = await SO.labelkitWahl(o.dir, name);
      if (w.datei){ D.lk = jsonVon(w.datei.text); D.lkName = w.datei.name; D.lkText = w.datei.text; D.lkStand = { name: 'Laboraufträge/' + w.datei.name, size: w.datei.file.size, t: w.datei.file.lastModified }; }
      else if (w.fremd.length) D.hinweise.push(`In LabelKit liegt nur „${w.fremd[0]}“ – nach dem Namen nicht von diesem Projekt; nicht gelesen.`); }
    if (!D.lk) D.hinweise.push('Keine LabelKit-Datei dieses Projekts – Proben und Entnahmestellen sind nicht prüfbar.'); }
  catch(e){ D.hinweise.push('LabelKit-Datei nicht lesbar: ' + e.message); }
  // Prüfberichte wie das Datenarchiv (archiv/lesen.js): XML in „Laborergebnisse“ und eine Ebene darunter; Dateistand wie ResultKit
  const lab = await unterordner(dir, 'Laborergebnisse'), xml = [], oben = [], pdf = [];
  const lauf = async (d, tiefe) => { for await (const h of d.values()){
    if (h.kind === 'directory'){ if (tiefe < 1) await lauf(h, tiefe + 1); continue; }
    if (tiefe === 0 && /\.(xml|pdf)$/i.test(h.name)){ const f = await h.getFile(); oben.push({ name: h.name, size: f.size, t: f.lastModified }); }
    if (h.name.startsWith('~$')) continue;
    if (/\.xml$/i.test(h.name)) xml.push(h); else if (/\.pdf$/i.test(h.name)) pdf.push({ name: h.name, h, tiefe }); } };
  if (lab) await lauf(lab, 0);
  D.labDir = lab; D.pdfHandles = pdf;
  const berichte = [];
  for (const h of xml){ const f = await h.getFile(); if (f.size > 10 * 1024 * 1024) continue; let r = null; try{ r = R.xmlLesen(await f.text()); }catch(e){} if (r) berichte.push({ ...r, datei: h.name, geaendert: f.lastModified }); }
  const eigen = A.projektAuswerten(berichte, nr);
  let datei = null, aktuell = false;
  try{ const o = await SO.ort(dir, 'resultkit'); const j = await dateiLesen(o.dir, '_Ergebnisse.json');
    if (j){ const x = jsonVon(j.text); if (!x || x.format !== 'spektron-ergebnisse' || x.version !== 1 || !Array.isArray(x.berichte) || typeof x.stand !== 'string') throw Error('kein bekanntes Format');
      datei = x; aktuell = A.standKennung(D.lkStand ? [...oben, D.lkStand] : oben) === x.stand; } }
  catch(e){ D.hinweise.push('_Ergebnisse.json lässt sich nicht lesen – geprüft wird gegen die Prüfberichte im Ordner.'); }
  // Strenger als das Datenarchiv: Werte aus einer nicht aktuellen Übernahme zählen nie (auch nicht aus einer PDF, die noch daliegt)
  const z = A.mitErgebnisDatei(eigen, datei, aktuell, () => false, nr);
  Object.assign(D, { messungen: z.messungen, unterschiede: z.unterschiede, quelle: z.quelle, konflikte: eigen.konflikte, aktuell, ergebnisseDa: !!datei, uebernommen: datei && datei.uebernommen });
  const xmlBasis = new Set(xml.map(h => h.name.replace(/\.xml$/i, '').normalize('NFC').toLowerCase()));
  const fremd = new Map(eigen.fremd.map(f => [A.norm(f.bericht), f]));
  const liste = new Map(), dazu = b => { const k = A.norm(b.code); if (!k) return; const alt = liste.get(k); liste.set(k, alt ? { ...b, ...alt, quelle: alt.quelle + '+' + b.quelle, datum: alt.datum || b.datum, pdf: alt.pdf || b.pdf } : b); };
  for (const r of berichte){ const code = tidy(r.bericht) || r.datei, f = fremd.get(A.norm(code)), basis = r.datei.replace(/\.xml$/i, '');
    dazu({ code, ...A.berichtsFassung(code), vorlaeufig: r.vorlaeufig, datei: r.datei, quelle: 'xml', fremd: f ? f.nr : '', ref: r.auftragsreferenz, pdf: (pdf.find(p => gleichName(p.name.replace(/\.pdf$/i, ''), basis)) || {}).name || '' }); }
  // Aus _Ergebnisse.json nur Berichte, deren Datei noch in „Laborergebnisse“ liegt – oder alle, wenn die Übernahme aktuell ist
  // (Codex, PR #1: eine alte Übernahme mit einer inzwischen gelöschten -02 macht -01 sonst fälschlich „überholt“)
  const obenNamen = new Set(oben.map(x => x.name.normalize('NFC').toLowerCase())), liegtDa = n => !!n && obenNamen.has(String(n).normalize('NFC').toLowerCase());
  for (const b of datei ? datei.berichte : []){ if (!b || !b.bericht || !(aktuell || liegtDa(b.sources && b.sources.xml) || liegtDa(b.sources && b.sources.pdf))) continue; const pn = SO.projektNr(String(b.auftragsreferenz || '').replace(/^\D*/, '')) || (String(b.auftragsreferenz || '').match(/\b\d{2}\.\d{3,6}\b/) || [''])[0];
    dazu({ code: tidy(b.bericht), ...A.berichtsFassung(b.bericht), vorlaeufig: !!b.vorlaeufig, datei: (b.sources && (b.sources.xml || b.sources.pdf)) || '', quelle: 'resultkit', datum: b.datum || '', fremd: pn && nr && pn !== nr ? pn : '', ref: b.auftragsreferenz, pdf: (b.sources && b.sources.pdf) || '' }); }
  D.berichte = [...liste.values()];
  D.ersetzt = [...eigen.ersetzt, ...(datei && aktuell && Array.isArray(datei.ersetzt) ? datei.ersetzt.map(e => e && e.bericht).filter(Boolean) : [])];
  D.pdfNamen = pdf.map(p => p.name);
  const vonErgebnis = new Set((datei && aktuell ? datei.berichte : []).map(b => b && b.sources && b.sources.pdf).filter(Boolean).map(n => n.normalize('NFC').toLowerCase()));
  D.pdfOhneXml = pdf.filter(p => p.tiefe === 0 && !xmlBasis.has(p.name.replace(/\.pdf$/i, '').normalize('NFC').toLowerCase()) && !vonErgebnis.has(p.name.normalize('NFC').toLowerCase())).map(p => p.name);
  // eigene Auftragsreferenzen: aus der Übernahme nur, was auch als Bericht gilt (aktuell oder Datei liegt noch da) – Codex, PR #1
  D.auftragsreferenzen = [...berichte.map(b => b.auftragsreferenz), ...(datei ? datei.berichte.filter(b => b && (aktuell || liegtDa(b.sources && b.sources.xml) || liegtDa(b.sources && b.sources.pdf))).map(b => b.auftragsreferenz) : [])].filter(Boolean);
  if (datei && !aktuell) D.hinweise.push('Die ResultKit-Übernahme passt nicht mehr zum Ordner „Laborergebnisse“ – LektorKit prüft gegen die XML im Ordner. In ResultKit „Erneut übernehmen“.');
  if (!berichte.length && !datei) D.hinweise.push('Keine lesbaren Prüfberichte (XML) und keine ResultKit-Übernahme.');
  const m = await unterordner(dir, 'Mitteilungen'); D.mitDir = m; D.mitteilungen = [];
  if (m) for await (const h of m.values()) if (h.kind === 'file' && /\.docx$/i.test(h.name) && !h.name.startsWith('~$')){ const f = await h.getFile(); D.mitteilungen.push({ name: h.name, t: f.lastModified, h }); }
  const anlage = n => /_Brandgeruch|_PN98/i.test(n);
  D.mitteilungen.sort((a, b) => anlage(a.name) - anlage(b.name) || /Mitteilung/i.test(b.name) - /Mitteilung/i.test(a.name) || b.t - a.t);
  return D;
}

/* ---------- Andere Projekte im Archiv ---------- */
async function einProjekt(h){
  const nr = SO.projektNr(h.name); let pj = null;
  for (const weg of [['_Spektron', '_Projekt.json'], ['_Projekt.json']]){ if (pj) break;
    try{ let d = h; for (const t of weg.slice(0, -1)) d = await d.getDirectoryHandle(t); const f = await (await d.getFileHandle(weg[weg.length - 1])).getFile();
      if (f.size > 1024 * 1024) continue; const o = jsonVon(await f.text()); if (o && typeof o === 'object' && !Array.isArray(o)) pj = o; }catch(e){} }
  return { name: h.name, nr, pj };
}
async function andereLesen(archiv, eigen){
  const dirs = [];
  for await (const h of archiv.values()) if (h.kind === 'directory' && /^\d{2}\.\d{2,6}(?:[\s_-]|$)/.test(h.name.normalize('NFC').trim()) && !gleichName(h.name, eigen)) dirs.push(h);
  const out = []; let i = 0, fertig = 0;
  const arbeiter = async () => { while (i < dirs.length){ const h = dirs[i++]; out.push(await einProjekt(h)); fertig++; if (fertig % 25 === 0) status(`Andere Projekte: ${fertig} von ${dirs.length} gelesen …`); } };
  await Promise.all(Array.from({ length: 8 }, arbeiter));
  return out;
}

/* ---------- „Ist so gewollt“ ---------- */
async function gewolltOrt(dir, anlegen){
  if (await SO.istSpektronProjekt(dir)){
    const sp = await SO.spektronDir(dir, anlegen); if (!sp) return { dir: null, pfad: '_Spektron/LektorKit/' + DATEI };
    let d = null; try{ d = await sp.getDirectoryHandle('LektorKit', anlegen ? { create: true } : undefined); }catch(e){}
    return { dir: d, pfad: '_Spektron/LektorKit/' + DATEI };
  }
  return { dir: await unterordner(dir, 'Mitteilungen'), pfad: 'Mitteilungen/' + DATEI };   // Vor Spektron: nie „_Spektron“ anlegen
}
async function gewolltLesen(dir){
  const o = await gewolltOrt(dir, false), j = await dateiLesen(o.dir, DATEI);
  if (!j) return { liste: [], text: null };
  const x = jsonVon(j.text);
  if (!x || x.format !== FORMAT || !Array.isArray(x.gewollt)) throw Error(`„${o.pfad}“ hat ein unbekanntes Format – LektorKit überschreibt sie nicht.`);
  if (x.version > 1) throw Error(`„${o.pfad}“ stammt von einer neueren LektorKit-Fassung.`);
  return { liste: x.gewollt.filter(g => g && typeof g.schluessel === 'string'), roh: x, text: j.text };
}
async function gewolltSchreiben(dir, aendern){
  if (dir.requestPermission && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') throw Error('Ohne Schreibrecht kann LektorKit die Bestätigung nicht vermerken.');
  const frisch = await gewolltLesen(dir);   // vor dem Schreiben frisch lesen: Bestätigungen von Kollegen bleiben
  const o = await gewolltOrt(dir, true);
  if (!o.dir) throw Error('Ordner „Mitteilungen“ fehlt.');
  const liste = aendern(frisch.liste.slice());
  const x = { ...(frisch.roh || {}), format: FORMAT, version: 1, hinweis: 'LektorKit: als gewollt bestätigte Stellen in Berichten dieses Projekts. Bitte nicht von Hand ändern.',
    gewollt: liste, geaendert: new Date().toISOString(), geaendertMit: 'LektorKit ' + K.VERSION };
  const text = JSON.stringify(x, null, 2) + '\n', fh = await o.dir.getFileHandle(DATEI, { create: true }), w = await fh.createWritable();
  try{ await w.write(text); await w.close(); }catch(e){ try{ await w.abort(); }catch(_){} throw e; }
  if (await (await fh.getFile()).text() !== text) throw Error('Kontrolle nach dem Speichern fehlgeschlagen – bitte erneut versuchen.');
  return liste;
}
async function kuerzelHolen(){
  try{ const k = localStorage.getItem('lektorkit-kuerzel') || localStorage.getItem('spektron-ich'); if (k) return k; }catch(e){}
  let personen = [];
  if (S.archiv){ const j = await dateiLesen(S.archiv, '_Spektron-Mitarbeiter.json'); try{ const o = j && jsonVon(j.text); if (o && Array.isArray(o.personen)) personen = o.personen.filter(p => p && p.ordnerKuerzel); }catch(e){} }
  const sel = $('selKuerzel'), txt = $('txtKuerzel');
  sel.innerHTML = personen.map(p => `<option value="${esc(p.ordnerKuerzel)}">${esc(p.ordnerKuerzel)} – ${esc(p.name || '')}</option>`).join('');
  sel.classList.toggle('versteckt', !personen.length); txt.classList.toggle('versteckt', !!personen.length);
  const dlg = $('dlgKuerzel'); dlg.returnValue = '';
  return new Promise(ok => { dlg.onclose = () => { const k = dlg.returnValue === 'ok' ? tidy(personen.length ? sel.value : txt.value) : '';
    if (k) try{ localStorage.setItem('lektorkit-kuerzel', k); }catch(e){} ok(k); }; dlg.showModal(); });
}
/** Kalendertag hier (nicht UTC – kurz nach Mitternacht sonst der Vortag; Codex, PR #1). */
const heute = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/* Schreibvorgänge nacheinander: zwei schnelle Klicks lesen sonst denselben alten Stand und der zweite überschreibt den ersten (Codex, PR #1). */
let schreibKette = Promise.resolve();
const nacheinander = fn => (schreibKette = schreibKette.then(fn, fn));
async function alsGewollt(id){
  const m = S.erg.marken[id]; if (!m) return;
  const kuerzel = await kuerzelHolen(); if (!kuerzel) return;
  const eintrag = { schluessel: m.schluessel, text: m.text, befund: m.befund || m.titel, abdruck: m.abdruck, datei: S.bericht.name, kuerzel, am: heute() };
  return gebunden(l => l.filter(g => g.schluessel !== eintrag.schluessel).concat([eintrag]), 'Nicht vermerkt: ');
}
async function zuruecknehmen(id){
  const m = S.erg.marken[id]; if (!m) return;
  const k = m.schluessel;
  return gebunden(l => l.filter(g => g.schluessel !== k), 'Nicht geändert: ');
}
/** Schreiben in das Projekt, in dem geklickt wurde – auch wenn inzwischen ein anderes geöffnet ist; das Ergebnis erscheint nur dort (Codex, PR #1). */
function gebunden(aendern, fehlerText){
  const dir = S.dir, lauf = S.oeffnenLauf;
  return nacheinander(async () => { try{ const liste = await gewolltSchreiben(dir, aendern); if (lauf === S.oeffnenLauf){ S.gewollt = liste; neuAuswerten(); } }
    catch(e){ if (lauf === S.oeffnenLauf) meldung(fehlerText + e.message); } });
}

/* ---------- Ablauf ---------- */
function status(t){ const e = $('dateiStand'); if (e) e.textContent = t; }
function meldung(t){ const e = $('meldung'); e.textContent = t; e.classList.toggle('versteckt', !t); if (!$('haupt').classList.contains('versteckt') && t) alertZeile(t); }
function alertZeile(t){ const u = $('uebersicht'); if (u){ const d = document.createElement('div'); d.className = 'zeile warn'; d.textContent = t; u.prepend(d); } }
function suiteDb(){ return new Promise((ok, nein) => { const r = indexedDB.open('mosaik-suite', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => nein(r.error); }); }
async function archivAusSpeicher(){ try{ const db = await suiteDb(); try{ return await new Promise((ok, nein) => { const r = db.transaction('kv').objectStore('kv').get('archiv'); r.onsuccess = () => ok(r.result && typeof r.result.values === 'function' ? r.result : null); r.onerror = () => nein(r.error); }); } finally { db.close(); } }catch(e){ return null; } }
const recht = async (h, fragen) => { if (!h.queryPermission) return true; let p = await h.queryPermission({ mode: 'read' }); if (p === 'prompt' && fragen) p = await h.requestPermission({ mode: 'read' }); return p === 'granted'; };

async function oeffnen(dir, archiv, wunsch){
  // Jeder Aufruf bekommt eine Nummer; ein älterer, langsamerer Lauf schreibt nichts mehr in den Zustand (Codex, PR #1)
  const lauf = ++S.oeffnenLauf, veraltet = () => lauf !== S.oeffnenLauf;
  // der Bericht des vorigen Projekts verschwindet sofort – nichts davon darf unter dem neuen Projekt stehen bleiben (Codex, PR #1)
  S.andereLauf++; S.lesenLauf++; S.doc = null; S.erg = null; S.bericht = null; S.gewaehlt = null; S.laedt = true;   // solange: kein Bericht lesbar (Codex, PR #1)
  $('haupt').classList.add('versteckt'); $('fuss').classList.add('versteckt'); $('start').classList.remove('versteckt'); $('berichtWahl').classList.add('versteckt');
  meldung(''); $('projektKopf').innerHTML = `<b>${esc(dir.name)}</b><span>wird gelesen …</span>`;
  let daten;
  try{ daten = await projektLesen(dir); }
  catch(e){ if (!veraltet()){ S.dir = null; S.daten = null; S.archiv = null; S.laedt = false; $('projektKopf').innerHTML = `<b>${esc(dir.name)}</b><span>nicht lesbar</span>`;
    meldung(`„${dir.name}“ lässt sich nicht lesen: ${e.message}`); } return null; }   // nie mit dem vorigen Projekt weiterarbeiten (Codex, PR #1)
  if (veraltet()) return null;
  let gewollt = [], gewolltFehler = '';
  try{ gewollt = (await gewolltLesen(dir)).liste; }catch(e){ gewolltFehler = e.message; }
  if (veraltet()) return null;
  S.dir = dir; S.archiv = archiv || null; S.andere = null; S.andereStatus = ''; S.daten = daten; S.gewollt = gewollt; S.gewolltFehler = gewolltFehler; S.laedt = false;
  const pj = S.daten.pj || {};
  $('projektKopf').innerHTML = `<b>${esc(dir.name)}</b><span>${esc([pj.schadennummer ? 'Schaden-Nr. ' + tidy(pj.schadennummer).replace(/\n/g, ', ') : '', pj.zustaendig && pj.zustaendig.kuerzel ? 'Zuständig: ' + pj.zustaendig.kuerzel : ''].filter(Boolean).join(' · '))}</span>`;
  const sel = $('selBericht');
  sel.innerHTML = S.daten.mitteilungen.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('') || '<option value="">– keine Word-Datei in „Mitteilungen“ –</option>';
  let gefunden = false;
  if (wunsch){ const i = S.daten.mitteilungen.findIndex(x => gleichName('Mitteilungen/' + x.name, wunsch) || gleichName(x.name, wunsch)); if (i >= 0){ sel.value = String(i); gefunden = true; } }
  $('berichtWahl').classList.remove('versteckt'); $('btnFreigeben').classList.add('versteckt');
  if (S.archiv) andereVorbereiten();
  else S.andereStatus = 'fehlt';
  // Nur den verlangten Bericht lesen – fehlt er, nie still einen anderen (Codex, PR #1)
  if (gefunden) await lesen();
  else if (wunsch && !veraltet()){ S.doc = null; $('haupt').classList.add('versteckt'); $('fuss').classList.add('versteckt'); $('start').classList.remove('versteckt');
    meldung(`Der Bericht „${wunsch}“ liegt nicht in „Mitteilungen“ (umbenannt oder gelöscht?). Bitte unten den richtigen wählen.`); }
  return veraltet() ? null : lauf;
}
async function andereVorbereiten(){
  // Lauf an dieses Projekt binden: öffnet jemand inzwischen ein anderes, wird das Ergebnis verworfen (Codex, PR #1)
  const lauf = ++S.andereLauf, archiv = S.archiv, name = S.dir.name, nr = S.daten.projekt.nr, aktuell = () => lauf === S.andereLauf;
  S.andereStatus = 'laeuft';
  let status, index = null, fehler = '';
  try{ if (!(await recht(archiv, false))) status = 'fehlt';
    else { const liste = await andereLesen(archiv, name); index = K.andereIndex(liste, nr); status = 'ok'; } }
  catch(e){ status = 'fehler'; fehler = e.message; }
  if (!aktuell()) return;
  S.andere = index; S.andereStatus = status; S.andereFehler = fehler;
  if (S.doc) neuAuswerten();
}
async function lesen(datei){
  // eigene Laufnummer: ein langsamerer, älterer Lesevorgang (oder einer aus einem inzwischen gewechselten Projekt) wird verworfen (Codex, PR #1)
  if (S.laedt || !S.daten) return;   // während ein Projekt geladen wird, gehört ein Bericht zu keinem Projekt
  const lauf = ++S.lesenLauf, projekt = S.oeffnenLauf, veraltet = () => lauf !== S.lesenLauf || projekt !== S.oeffnenLauf;
  let bytes, name, quelle, doc;
  try{
    if (datei){ bytes = await datei.arrayBuffer(); name = datei.name; quelle = 'abgelegt'; }
    else { const x = S.daten.mitteilungen[Number($('selBericht').value)]; if (!x) return; const f = await x.h.getFile(); bytes = await f.arrayBuffer(); name = x.name; quelle = 'Mitteilungen'; }
    doc = await K.docxLesen(bytes);
  }catch(e){ if (!veraltet()) meldung(`„${name || 'Bericht'}“ lässt sich nicht lesen: ${e.message}`); return; }
  if (veraltet()) return;
  S.doc = doc; S.bericht = { name, quelle, datei: datei || null }; S.gelesenAm = new Date(); S.gewaehlt = null;
  $('start').classList.add('versteckt'); $('haupt').classList.remove('versteckt'); $('fuss').classList.remove('versteckt');
  neuAuswerten();
}
function neuAuswerten(){
  if (!S.doc) return;
  S.erg = K.analysieren(S.doc, { ...S.daten, andere: S.andereStatus === 'ok' ? S.andere : null, gewollt: S.gewollt });
  zeichnen();
}

/* ---------- Zeichnen ---------- */
const ort0 = () => S.doc && S.doc.bloecke.some(b => b.ueb && /^1\.?\s/.test(b.seg.text.trim())) ? 'Deckblatt' : 'Anfang';
const ICONS = {
  ok: '<svg class="ic" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg class="ic" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l6.3 11.3H1.7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6.5v3.4M8 11.6v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  x: '<svg class="ic" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' };
const STATUS_NAME = { belegt: 'belegt', abweicht: 'weicht ab', fremd: 'anderes Projekt', ohne: 'ohne Beleg' };
function segHtml(seg, jeSeg){
  const ms = jeSeg.get(seg.id) || [], t = seg.text; let out = '', pos = 0;
  const txt = s => esc(s).replace(/\t+/g, ' ').replace(/\n/g, '<br>');
  for (const m of ms){ if (m.von < pos) continue; out += txt(t.slice(pos, m.von));
    const kl = m.gewollt ? 'gewollt' : m.status, ic = ICONS[m.icon] || '';
    out += `<span class="m ${kl}" data-id="${m.id}" tabindex="0" role="button" aria-label="${esc(STATUS_NAME[m.status] + (m.gewollt ? ', als gewollt bestätigt' : '') + ': ' + m.text)}">${txt(m.text)}${ic}</span>`; pos = m.bis; }
  return out + txt(t.slice(pos));
}
function zeichnen(){
  const e = S.erg, jeSeg = new Map();
  for (const m of e.marken) jeSeg.set(m.seg, [...(jeSeg.get(m.seg) || []), m]);
  let h = '', abschnitt = null;
  for (const b of S.doc.bloecke){
    if (b.typ === 'p'){ if (!b.seg.text.trim()) continue;
      h += `<p class="${b.kopf ? 'kopfz' : b.ueb ? 'ueb' : ''}">${segHtml(b.seg, jeSeg)}</p>`; }
    else h += '<table>' + b.zeilen.map(z => '<tr>' + z.map(s => `<td>${segHtml(s, jeSeg)}</td>`).join('') + '</tr>').join('') + '</table>';
  }
  $('seite').innerHTML = h;
  $('dateiName').textContent = S.bericht.name + (S.bericht.quelle === 'abgelegt' ? ' (abgelegt, nicht im Projektordner gespeichert)' : '');
  status(`gelesen ${S.gelesenAm.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} · LektorKit ${K.VERSION}`);
  uebersichtZeichnen(); befundeZeichnen();
  if (S.gewaehlt != null) belegZeigen(S.gewaehlt, false); else $('belegKarte').classList.add('versteckt');
  protokollBauen();
}
function zeilenListe(){
  const e = S.erg, z = [], np = e.nichtPruefbar.reduce((s, x) => s + x.n, 0);
  if (np) z.push(['warn', `⚠ ${np} ${np === 1 ? 'Angabe' : 'Angaben'} nicht prüfbar – weder belegt noch geprüft: ${e.nichtPruefbar.map(x => `${x.n} × ${x.grund}`).join('; ')}.`]);
  if (S.andereStatus === 'ok') z.push(['info', `Andere Projekte: ${S.andere.gelesen} gelesen – ${S.andere.voll} mit Projektdaten, ${S.andere.nurName} nur über den Ordnernamen (dort nur die Projektnummer und eine Adresse mit Hausnummer im Namen).`]);
  else if (S.andereStatus === 'laeuft') z.push(['info', 'Andere Projekte werden noch gelesen …']);
  else z.push(['warn', `⚠ Andere Projekte nicht geprüft – ${S.andereStatus === 'fehler' ? 'Archiv nicht lesbar: ' + (S.andereFehler || '') : 'kein Zugriff auf den Archivordner (aus der Projektzentrale öffnen)'}.`]);
  for (const t of S.daten.hinweise) z.push(['info', t]);
  if (S.gewolltFehler) z.push(['warn', '⚠ ' + S.gewolltFehler]);
  return z;
}
function kopfzeile(){
  const z = S.erg.zaehler, offen = z.abweicht + z.fremd, np = S.erg.nichtPruefbar.reduce((s, x) => s + x.n, 0);
  const keine = z.gewollt ? `Keine offene Abweichung (${z.gewollt} als gewollt bestätigt)` : 'Keine Abweichung gefunden';
  if (offen) return `${offen} ${offen === 1 ? 'Stelle' : 'Stellen'} ansehen, bevor du fertigstellst`;
  if (np) return `${keine} – aber ${np} ${np === 1 ? 'Angabe' : 'Angaben'} nicht prüfbar`;
  if (S.andereStatus !== 'ok') return `${keine} – andere Projekte nicht geprüft`;
  return keine;
}
function uebersichtZeichnen(){
  const z = S.erg.zaehler;
  $('uebersicht').innerHTML = `<h2 id="kopfzeile">${esc(kopfzeile())}</h2>
   <div class="kacheln">
    <div class="kachel k-ok"><b id="z-belegt">${z.belegt}</b><span>Angaben belegt</span></div>
    <div class="kachel k-ab"><b id="z-abweicht">${z.abweicht}</b><span>weichen ab</span></div>
    <div class="kachel k-fr"><b id="z-fremd">${z.fremd}</b><span>aus anderem Projekt</span></div>
    <div class="kachel k-ob"><b id="z-ohne">${z.ohne}</b><span>ohne Beleg</span></div>
   </div>${z.gewollt ? `<div class="klein">${z.gewollt} als gewollt bestätigt</div>` : ''}
   ${zeilenListe().map(([k, t]) => `<div class="zeile ${k}">${esc(t)}</div>`).join('')}`;
}
function befundKarte(m){
  const kat = (m.status === 'fremd' ? 'ANDERES PROJEKT' : 'WEICHT AB') + ' · ' + (m.abschnitt || ort0());
  const g = m.gewollt;
  return `<div class="karte befund ${g ? 'gewollt' : m.status}" data-befund="${m.id}">
   <div class="kat">${esc(g ? 'GEWOLLT · ' + (m.abschnitt || ort0()) : kat)}</div>
   <div class="titel">${esc(m.befund || m.titel)}</div>
   ${m.notiz ? `<div class="klein">${esc(m.notiz)}</div>` : ''}
   ${g ? `<div class="klein">Bestätigt von ${esc(g.kuerzel)} am ${esc(K.deDatum(g.am))}</div>` : ''}
   <div class="knoepfe"><button data-zeigen="${m.id}">Im Bericht zeigen</button>${g ? `<button data-zurueck="${m.id}">Zurücknehmen</button>` : `<button data-gewollt="${m.id}">Ist so gewollt</button>`}</div></div>`;
}
function befundeZeichnen(){
  const offen = S.erg.marken.filter(m => (m.status === 'abweicht' || m.status === 'fremd') && !m.gewollt), gewollt = S.erg.marken.filter(m => m.gewollt);
  $('befunde').innerHTML = offen.map(befundKarte).join('') + gewollt.map(befundKarte).join('');
}
function belegZeigen(id, scroll){
  const m = S.erg.marken[id]; if (!m) return;
  S.gewaehlt = id;
  document.querySelectorAll('.m.gewaehlt').forEach(x => x.classList.remove('gewaehlt'));
  const el = document.querySelector(`#seite .m[data-id="${id}"]`); if (el){ el.classList.add('gewaehlt'); if (scroll){ el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink'); } }
  const k = $('belegKarte'), st = m.gewollt ? 'gewollt' : m.status;
  k.className = 'karte beleg ' + m.status;
  k.innerHTML = `<div class="kat befund" style="font-size:12px;font-weight:700;letter-spacing:.04em">${esc((m.gewollt ? 'GEWOLLT' : STATUS_NAME[m.status].toUpperCase()) + ' · ' + (m.abschnitt || ort0()))}</div>
   <div style="font-size:20px;font-weight:700">${esc(m.titel)}</div>
   ${m.befund ? `<div class="titel" style="font-weight:600">${esc(m.befund)}</div>` : ''}
   ${(m.beleg || []).length ? `<dl>${m.beleg.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>` : ''}
   ${m.notiz ? `<div class="klein">${esc(m.notiz)}</div>` : ''}
   <div class="klein">Stelle im Bericht: ${esc(/^(Kopfzeile|Fußzeile|Fußnote|Endnote)$/.test(m.abschnitt || '') ? m.abschnitt : m.abschnitt ? 'Abschnitt ' + m.abschnitt : ort0())} – Seitenzahlen kennt nur Word.</div>
   <div class="knoepfe">${m.pdf ? `<button data-pdf="${esc(m.pdf)}">Prüfbericht öffnen</button>` : ''}${(m.status === 'abweicht' || m.status === 'fremd') ? (m.gewollt ? `<button data-zurueck="${m.id}">Zurücknehmen</button>` : `<button data-gewollt="${m.id}">Ist so gewollt</button>`) : ''}<button data-schliessen="1">Schließen</button></div>`;
  k.classList.remove('versteckt'); void st;
}
async function pdfOeffnen(name){
  const p = (S.daten.pdfHandles || []).find(x => gleichName(x.name, name)); if (!p){ meldung(`„${name}“ liegt nicht in „Laborergebnisse“.`); return; }
  const url = URL.createObjectURL(await p.h.getFile()); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---------- Prüfprotokoll (eine Seite) ---------- */
function protokollBauen(){
  const e = S.erg, z = e.zaehler, pj = S.daten.pj || {}, MAX = 24;
  const liste = e.marken.filter(m => m.status === 'abweicht' || m.status === 'fremd');
  const zeile = m => `<tr><td>${esc(m.abschnitt || ort0())}</td><td>${esc(m.text)}</td><td>${esc(m.befund || m.titel)}${m.notiz ? ' – ' + esc(m.notiz) : ''}</td><td>${m.status === 'fremd' ? 'anderes Projekt' : 'weicht ab'}</td><td>${m.gewollt ? `gewollt (${esc(m.gewollt.kuerzel)}, ${esc(K.deDatum(m.gewollt.am))})` : 'offen'}</td></tr>`;
  $('protokoll').innerHTML = `<h1>Prüfprotokoll LektorKit</h1>
   <div>${esc(S.daten.projekt.name)}${pj.schadennummer ? ' · Schaden-Nr. ' + esc(tidy(pj.schadennummer).replace(/\n/g, ', ')) : ''}</div>
   <div>Bericht: ${esc(S.bericht.name)}${S.bericht.quelle === 'abgelegt' ? ' (abgelegt)' : ''} · gelesen ${esc(S.gelesenAm.toLocaleString('de-DE'))} · LektorKit ${K.VERSION}</div>
   <p><b>${esc(kopfzeile())}</b> – belegt ${z.belegt} · weicht ab ${z.abweicht} · anderes Projekt ${z.fremd} · ohne Beleg ${z.ohne} · als gewollt bestätigt ${z.gewollt}</p>
   ${zeilenListe().filter(x => x[0] === 'warn').map(([, t]) => `<div class="p-warn">${esc(t)}</div>`).join('')}
   ${liste.length ? `<table><tr><th>Abschnitt</th><th>Im Text</th><th>Befund</th><th>Art</th><th>Stand</th></tr>${liste.slice(0, MAX).map(zeile).join('')}</table>${liste.length > MAX ? `<div>… und ${liste.length - MAX} weitere – siehe LektorKit.</div>` : ''}` : '<p>Keine Stelle weicht ab, keine stammt aus einem anderen Projekt.</p>'}
   <div style="font-size:8pt;margin-top:2mm">„ohne Beleg“ = eigene Angabe des Sachverständigen oder nicht sicher einer Probe zuzuordnen – kein Fehler. LektorKit liest nur; am Bericht wurde nichts geändert.</div>
   <div class="p-unter"><div>Geprüft: ____________________</div><div>Datum: ____________</div></div>`;
}

/* ---------- Ereignisse ---------- */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-id],[data-zeigen],[data-gewollt],[data-zurueck],[data-pdf],[data-schliessen]'); if (!t) return;
  if (t.dataset.zeigen) belegZeigen(Number(t.dataset.zeigen), true);
  else if (t.dataset.gewollt) alsGewollt(Number(t.dataset.gewollt));
  else if (t.dataset.zurueck) zuruecknehmen(Number(t.dataset.zurueck));
  else if (t.dataset.pdf) pdfOeffnen(t.dataset.pdf);
  else if (t.dataset.schliessen){ S.gewaehlt = null; $('belegKarte').classList.add('versteckt'); document.querySelectorAll('.m.gewaehlt').forEach(x => x.classList.remove('gewaehlt')); }
  else if (t.dataset.id && t.closest('#seite')) belegZeigen(Number(t.dataset.id), false);
});
document.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('m') && ev.target.closest('#seite')){ ev.preventDefault(); belegZeigen(Number(ev.target.dataset.id), false); } });
$('btnProjekt').onclick = async () => {
  if (!window.showDirectoryPicker){ meldung('Dieser Browser kann keine Ordner öffnen. Bitte Edge oder Chrome benutzen.'); return; }
  let dir; try{ dir = await window.showDirectoryPicker({ mode: 'read', id: 'lektorkit' }); }catch(e){ return; }
  // Liegt der Ordner im Archiv der Suite, gehört der Archivordner dazu (für „anderes Projekt“)
  let archiv = await archivAusSpeicher();
  if (archiv){ try{ const weg = await archiv.resolve(dir); if (!weg || weg.length !== 1) archiv = null; }catch(e){ archiv = null; } }
  await oeffnen(dir, archiv);
};
$('btnLesen').onclick = () => lesen();
// Neu einlesen: derselbe Bericht – liegt er nicht mehr in „Mitteilungen“, wird nichts anderes gelesen (Codex, PR #1)
$('btnNeu').onclick = async () => { const d = S.bericht && S.bericht.datei, name = S.bericht && S.bericht.name;
  const lauf = await oeffnen(S.dir, S.archiv, d ? '' : 'Mitteilungen/' + name);
  if (d && lauf !== null && lauf === S.oeffnenLauf) await lesen(d); };   // abgelegte Datei nur ins selbe, nicht überholte Projekt (Codex, PR #1)
$('btnAndererBericht').onclick = () => { $('haupt').classList.add('versteckt'); $('fuss').classList.add('versteckt'); $('start').classList.remove('versteckt'); };
$('btnDrucken').onclick = () => { protokollBauen(); window.print(); };
$('btnDatei').onclick = () => $('eingabeDatei').click();
$('eingabeDatei').onchange = ev => { const f = ev.target.files[0]; if (f) lesen(f); ev.target.value = ''; };
const ab = $('ablage');
ab.addEventListener('dragover', ev => { ev.preventDefault(); ab.classList.add('drueber'); });
ab.addEventListener('dragleave', () => ab.classList.remove('drueber'));
ab.addEventListener('drop', ev => { ev.preventDefault(); ab.classList.remove('drueber'); const f = [...ev.dataTransfer.files].find(x => /\.docx$/i.test(x.name)); if (f) lesen(f); else meldung('Bitte eine Word-Datei (.docx) ablegen.'); });

/* ---------- Aufruf aus der Projektzentrale: #projekt=<Ordnername>[&datei=Mitteilungen/<Datei>] ---------- */
async function sprung(){
  const h = new URLSearchParams(location.hash.slice(1)), projekt = h.get('projekt'); if (!projekt) return;
  const archiv = await archivAusSpeicher();
  if (!archiv){ meldung('Kein Archivordner gespeichert – bitte einmal die Projektzentrale öffnen oder „Projektordner öffnen …“.'); return; }
  const weiter = async () => { let dir = null; for await (const x of archiv.values()) if (x.kind === 'directory' && gleichName(x.name, projekt)){ dir = x; break; }
    if (!dir){ meldung(`Das Projekt „${projekt}“ liegt nicht im Archivordner „${archiv.name}“.`); return; }
    await oeffnen(dir, archiv, h.get('datei') || ''); };
  if (await recht(archiv, false)) return weiter();
  const b = $('btnFreigeben'); b.textContent = `Projekt „${projekt}“ öffnen`; b.classList.remove('versteckt');
  b.onclick = async () => { if (await recht(archiv, true)) weiter(); };
}
sprung();

/* Für die Prüfungen (tests/lektorkit-check.cjs): dieselben Wege wie die Knöpfe, ohne Dateidialog. */
window.LektorKitTest = { heute, oeffnen, lesen, zustand: () => S, warteAndere: async () => { while (S.andereStatus === 'laeuft') await new Promise(r => setTimeout(r, 20)); } };
})();
