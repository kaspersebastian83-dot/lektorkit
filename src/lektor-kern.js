/* LEKTOR-KERN – Bericht lesen und jede Angabe gegen die Projektdaten halten. Keine Dateizugriffe, keine Oberfläche.
   Grundsätze (Plan „gegenleser-plan.md“, Entscheidungen Basti 13.11.2026):
   • Nichts raten: Lässt sich eine Zahl nicht sicher genau einer Probe und einem Parameter zuordnen, ist sie „ohne Beleg“.
   • „ohne Beleg“ ist nie ein Fehler und zählt nie als Problem.
   • Gleich ist nur, was die bestehenden Regeln gleich nennen (Datenarchiv/ResultKit: Zahl streng gelesen, „< BG“, Einheit nur in der
     Schreibweise angeglichen). Umgerechnet wird nur Chlorid (1 µg/cm² = 10 mg/m²) und Σ16 EPA-PAK (Tabelle aus vdsScale). Keine Rundung:
     Passt die Zahl nur gerundet, ist sie „weicht ab“ – der Befund sagt „gerundet?“, damit „Ist so gewollt“ schnell geht.
   • Eine überholte Prüfberichtsfassung im Text ist „weicht ab“.
   • „anderes Projekt“ nur für Projektnummern, Schaden-Nr. und Straße mit Hausnummer anderer Projekte sowie Auftraggeber-/VN-/Versicherernamen
     ab 10 Zeichen – nie ein Ort allein, nie die Büroadresse, nie etwas, das auch in diesem Projekt steht. */
(function(root){
'use strict';
const A = root.ArchivAuswertung, R = root.LektorRegeln;
const tidy = A.tidy;
const VERSION = '1.0.0';

/* ---------- Word lesen ---------- */
/** Text eines Absatzes (auch in Tabellenzellen): Läufe in Dokumentreihenfolge; Tab, Zeilenumbruch, geschützter Bindestrich (BerichtKit
    schreibt Labor-Nr. damit) und weiches Trennzeichen wie in Word. Gelöschter und verschobener Alttext (Änderungen nachverfolgen: del, moveFrom), Feldbefehle und
    Textfelder zählen nicht. Geschütztes Leerzeichen → Leerzeichen (gleiche Länge, Positionen bleiben). */
function absatzText(p){
  let t = '';
  const geh = n => { for (const c of n.childNodes){ if (c.nodeType !== 1) continue; const ln = c.localName;
    if (ln === 't') t += c.textContent.replace(/[  ]/g, ' ');
    else if (ln === 'tab') t += '\t';
    else if (ln === 'br' || ln === 'cr') t += '\n';
    else if (ln === 'noBreakHyphen') t += '-';
    else if (ln === 'softHyphen' || ln === 'pPr' || ln === 'rPr' || ln === 'del' || ln === 'moveFrom' || ln === 'delText' || ln === 'instrText' || ln === 'txbxContent' || ln === 'fldSimple' && false) {}
    else geh(c); } };
  geh(p); return t;
}
const istUeberschrift = (text, p) => {
  const t = text.trim();
  if (p && [...p.getElementsByTagName('*')].some(e => e.localName === 'outlineLvl')) return t.length > 0 && t.length <= 90;
  return /^\d{1,2}(?:\.\d{1,2})*\.?\s+\p{Lu}/u.test(t) && t.length <= 90 && !/[.:;]$/.test(t) && !/\d\s*(?:µg|mg|ng|%)/.test(t);
};
/** XML eines Teils → Blöcke [{ typ:'p', seg, ueb } | { typ:'tab', zeilen:[[seg]] }]; segs bekommen fortlaufende Nummern. */
function teilBloecke(xml, teil, segs){
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error('Word-Datei beschädigt (' + teil + ')');
  const kinder = (n, name) => [...n.childNodes].filter(c => c.nodeType === 1 && c.localName === name);
  const neu = (text, art) => { const s = { id: segs.length, text, art, teil }; segs.push(s); return s; };
  const out = [];
  const lauf = n => { for (const c of n.childNodes){ if (c.nodeType !== 1) continue;
    if (c.localName === 'p'){ const text = absatzText(c); out.push({ typ: 'p', seg: neu(text, 'p'), ueb: teil === 'document' && istUeberschrift(text, c) }); }
    else if (c.localName === 'tbl'){ const zeilen = kinder(c, 'tr').map(tr => kinder(tr, 'tc').map(tc => neu([...tc.getElementsByTagName('*')].filter(e => e.localName === 'p' && e.parentNode === tc || e.localName === 'p' && e.parentNode.localName === 'sdtContent').map(absatzText).join('\n'), 'zelle')));
      out.push({ typ: 'tab', zeilen }); }
    else if (c.localName === 'sdt'){ const inh = kinder(c, 'sdtContent')[0]; if (inh) lauf(inh); }
    else if (c.localName === 'body') lauf(c); } };
  const wurzel = doc.documentElement;
  lauf(teil === 'document' ? (kinder(wurzel, 'body')[0] || wurzel) : wurzel);
  return out;
}
/** .docx (Bytes) → { bloecke, segs }. Kopfzeilen kommen einmal je Text vorn hin (Abschnitt „Kopfzeile“). */
/** Einen einzelnen ZIP-Eintrag lesen (für word/_rels/document.xml.rels, das word-luecken.js nicht liefert); null, wenn er fehlt. */
async function zipEintrag(bytes, gesucht){
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), u16 = i => b[i] | (b[i + 1] << 8), u32 = i => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  let ende = -1; for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 0xffff; i--) if (u32(i) === 0x06054b50){ ende = i; break; }
  if (ende < 0) return null;
  let p = u32(ende + 16); const dec = new TextDecoder();
  for (let n = 0, k = u16(ende + 10); n < k && p + 46 <= b.length && u32(p) === 0x02014b50; n++){
    const methode = u16(p + 10), groesse = u32(p + 20), nl = u16(p + 28), lokal = u32(p + 42), name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + u16(p + 30) + u16(p + 32);
    if (name !== gesucht) continue;
    const von = lokal + 30 + u16(lokal + 26) + u16(lokal + 28), roh = b.subarray(von, von + groesse);
    if (methode === 0) return dec.decode(roh);
    if (methode !== 8) return null;
    const strom = new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return dec.decode(new Uint8Array(await new Response(strom).arrayBuffer()));
  }
  return null;
}
/** Kopfzeilen, die ein Abschnitt des Dokuments wirklich benutzt (headerReference → Beziehung → Datei). Ohne lesbare Beziehungen: alle. */
async function benutzteKopfzeilen(bytes, documentXml, alle){
  // nach Namensraum und lokalem Namen, nicht nach Präfix (Codex, PR #1)
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const doc = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return alle;
  const ids = [...doc.getElementsByTagNameNS(W_NS, 'headerReference')].map(e => e.getAttributeNS(R_NS, 'id')).filter(Boolean);
  let rels = null; try{ rels = await zipEintrag(bytes, 'word/_rels/document.xml.rels'); }catch(e){ rels = null; }
  if (!rels) return alle;
  const rd = new DOMParser().parseFromString(rels, 'application/xml');
  if (rd.getElementsByTagName('parsererror').length) return alle;
  const ziel = new Map([...rd.getElementsByTagNameNS('*', 'Relationship')].map(e => [e.getAttribute('Id'), e.getAttribute('Target') || '']));
  const benutzt = new Set(ids.map(id => ziel.get(id)).filter(Boolean).map(t => 'word/' + t.replace(/^\/?(?:word\/)?/, '')));
  return alle.filter(n => benutzt.has(n));
}
async function docxLesen(bytes){
  const teile = await root.WordLuecken.textteile(bytes), segs = [], bloecke = [];
  // nur Kopfzeilen, die ein Abschnitt benutzt – liegengebliebene header*.xml zählen nicht (Codex, PR #1)
  const kopf = (await benutzteKopfzeilen(bytes, teile['word/document.xml'], Object.keys(teile).filter(n => /^word\/header\d*\.xml$/.test(n)))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const gesehen = new Set();
  for (const n of kopf) for (const b of teilBloecke(teile[n], 'kopf', segs)){
    const key = b.typ === 'p' ? b.seg.text.trim() : JSON.stringify(b.zeilen.map(z => z.map(s => s.text)));
    // doppelte Kopfzeile (erste Seite / Folgeseiten): ganz weglassen, auch die Zellen einer Tabelle (Codex, PR #1)
    if (!key || gesehen.has(key)){ for (const s of b.typ === 'p' ? [b.seg] : b.zeilen.flat()) s.leer = true; continue; } gesehen.add(key); b.kopf = true; bloecke.push(b); }
  bloecke.push(...teilBloecke(teile['word/document.xml'], 'document', segs));
  let abschnitt = '', titel = '';
  for (const b of bloecke){ if (b.kopf){ b.abschnitt = 'Kopfzeile'; continue; }
    // nur nummerierte Überschriften wechseln den Abschnitt („## Küche“-Zwischentitel bleiben im Abschnitt davor)
    if (b.typ === 'p' && b.ueb){ const m = /^(\d{1,2}(?:\.\d{1,2})*)\.?\s+(.*)$/.exec(b.seg.text.trim()); if (m){ abschnitt = m[1]; titel = m[2]; } }
    b.abschnitt = abschnitt; b.titel = titel; }
  for (const b of bloecke) for (const s of b.typ === 'p' ? [b.seg] : b.zeilen.flat()){ s.abschnitt = b.abschnitt; s.titel = b.titel || ''; }
  return { bloecke, segs };
}

/* ---------- Muster ---------- */
const EINHEIT = String.raw`[µμ]g\s?\/\s?100\s?cm(?:²|2)|[µμ]g\s?\/\s?cm(?:²|2)|mg\s?\/\s?m(?:²|2)|[µμ]g\s?\/\s?m(?:²|2)|ng\s?\/\s?m(?:²|2)|mg\s?\/\s?kg|M\.?-\s?%|m(?:²|2)(?![\p{L}\d\/])|°C`;
const ZAHL = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?`;
// Ergebnis wie im Prüfbericht: Zahl (auch mit „<“/„>“) oder „n. n.“ / „unter BG“ – dieselben Formen wie A.ergebnis (Codex, PR #1)
const WERT_RE = new RegExp(String.raw`(?<![\p{L}\d.,\-\/])(?:(<|>)\s*)?(${ZAHL}|n\.\s?n\.|unter\s+BG)\s?(${EINHEIT})`, 'gu');
const SPANNE_VOR = new RegExp(String.raw`\d(?:\s?(?:${EINHEIT}))?\s*(?:bis|–|—|-)\s*$`, 'u');
const PRUEF_EINHEIT = /^(?:[µμ]g\/100cm2|[µμ]g\/cm2|mg\/m2|[µμ]g\/m2|ng\/m2|mg\/kg|M\.?-%)$/i;
const einheitKurz = u => tidy(u).replace(/μ/g, 'µ').replace(/²/g, '2').replace(/\s+/g, '');
const PROBEN_RE = /(?<![\p{L}\d])(\p{L}*?[Pp]roben?)\s+(\d{1,4}(?:\s*(?:,|und|bis|sowie)\s*\d{1,4})*)(?![\d]|,\d)/gu;
const P_RE = /(?<![\p{L}\d])P(\d{1,4})(?![\p{L}\d])/gu;
const PB_RE = /(?<![\w\-])([A-Z]{2,4}(?:-[A-Z0-9]{1,12}){3,})(?![\w\-])/g;
const ANL_RE = /(?<![\p{L}])Anlagen?\s+(\d{1,2}(?:\s*(?:,|und|bis)\s*\d{1,2})*)(?![\d:])/gu;
const DATUM_RE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g;
const PNR_RE = /(?<![\d.,\p{L}])(\d{2}\.\d{3,6})(?!\d|[.,]\d)/gu;
const STRASSE_WORT = String.raw`straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|ufer|pfad|chaussee|markt|steig|stieg|wall|graben|kamp|hof`;
const STRASSE_RE = new RegExp(String.raw`(?<![\p{L}\d])((?:\p{Lu}[\p{L}\-]*\s(?:Straße|Strasse|Str\.|Weg|Platz|Allee|Gasse|Ring|Damm|Ufer|Pfad|Chaussee|Markt|Steig|Wall|Graben|Kamp|Hof))|(?:\p{Lu}[\p{L}\-]*?(?:${STRASSE_WORT})))\s+(\d{1,4}(?:\s?[a-z])?)(?![\p{L}\d])`, 'gu');
const ID_RE = /(?<![\w\-\/.])([A-Za-z0-9][A-Za-z0-9\-\/.]{3,}[A-Za-z0-9])(?![\w\-\/])/g;

/** Zahlenliste „2, 3 und 5“, „7 bis 10“ → [{ n, von, bis }] (Positionen relativ zum Listenanfang); „bis“ füllt nur die Menge. */
function zahlenListe(t){
  const teile = [...t.matchAll(/\d{1,4}/g)].map(m => ({ n: Number(m[0]), von: m.index, bis: m.index + m[0].length }));
  const menge = new Set(teile.map(x => x.n));
  for (const m of t.matchAll(/(\d{1,4})\s*bis\s*(\d{1,4})/g)){ const a = Number(m[1]), b = Number(m[2]); if (b > a && b - a < 200) for (let i = a; i <= b; i++) menge.add(i); }
  return { teile, menge };
}
/** Sätze eines Textes mit Positionen. Punkt nach Abkürzung, Initiale oder Ordnungszahl trennt nicht – im Zweifel bleibt ein Satz länger
    (dann eher „ohne Beleg“ als eine falsche Zuordnung). */
const ABK = new Set(['nr','ca','bzw','vgl','ggf','inkl','max','min','dr','hr','fr','str','abb','tab','anl','ziff','st','std','mio','tsd','usw','etc','evtl','sog','gem','lt','pkt','geb','kap','bl','u','z','e','d','s','o','i','r','b','v','m','a','h','n','prof','dipl','ing','zzgl','abs','bspw','jun','sen']);
function saetze(text){
  const out = []; let start = 0;
  const re = /[.!?](?=\s+["„(]?[\p{Lu}\d])/gu; let m;
  while ((m = re.exec(text))){
    const vor = text.slice(start, m.index), wort = (/([\p{L}\d]+)$/u.exec(vor) || [, ''])[1];
    if (ABK.has(wort.toLowerCase()) || /^\d{1,2}$/.test(wort) || /^\p{Lu}$/u.test(wort)) continue;
    out.push({ von: start, bis: m.index + 1 }); start = m.index + 1; }
  out.push({ von: start, bis: text.length });
  return out.filter(x => text.slice(x.von, x.bis).trim());
}
const ISO = (t, mo, j) => `${j}-${String(mo).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
const isoAus = v => { const t = tidy(v); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t); return m ? ISO(m[1], m[2], m[3]) : ''; };
const deDatum = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso;
/** Kleinschreibung, ein Leerzeichen, Striche/Anführungszeichen angeglichen – mit Rückverweis auf die Originalpositionen. */
function normMitMap(text){
  let s = '', map = [], leer = false;
  for (let i = 0; i < text.length; i++){
    let c = text[i];
    if (/\s/.test(c)){ if (!leer && s){ s += ' '; map.push(i); } leer = true; continue; }
    leer = false; c = c.toLocaleLowerCase('de').replace(/[‐-―−]/, '-').replace(/[„“”‚‘’«»]/, '"');
    for (const ch of c){ s += ch; map.push(i); } }
  return { s, map };
}
const normText = t => normMitMap(String(t || '')).s;
const strassenKey = (name, nr) => tidy(name).toLocaleLowerCase('de').replace(/ß/g, 'ss').replace(/(?:strasse|str\.?)$/, 'str').replace(/[^\p{L}\d]/gu, '') + '|' + tidy(nr).toLowerCase().replace(/\s/g, '');
function strassenIn(text){ return [...String(text || '').matchAll(STRASSE_RE)].map(m => ({ key: strassenKey(m[1], m[2]), text: m[0], von: m.index, bis: m.index + m[0].length })); }
const idKey = t => tidy(t).toUpperCase().replace(/[\-\/.\s]/g, '');
const schadenTeile = v => String(v || '').split(/[\n;]+/).map(tidy).filter(Boolean);
const BUERO = { strassen: new Set(['gouleystr|59']), namen: ['schiffers', 'eurofins', 'würselen', 'sachverständigenbüro'] };

/* ---------- Werte vergleichen ---------- */
/** Faktor: Wert in Einheit a × f = Wert in Einheit b, nur über die zwei bestehenden Tabellen; null = nicht vergleichbar. */
function faktor(a, b, param){
  if (A.einheit(a) === A.einheit(b)) return 1;
  const tab = param === 'Chlorid' ? R.chloridEinheit : param === 'PAK' ? R.pakEinheit : null; if (!tab) return null;
  const fa = tab(a), fb = tab(b); return fa && fb ? fb / fa : null;
}
const nachkomma = t => { const m = /,(\d+)\s*$/.exec(t); return m ? m[1].length : 0; };
const fmt = (v, d) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
const ziffern = t => String(t).replace(/\D/g, '').split('').sort().join('');
/** Text- gegen Laborwert. → { status, notiz } */
function wertVergleich(textRoh, textU, m, param){
  const f = faktor(textU, m.u, param);
  if (f === null) return { status: 'ohne', notiz: `Einheit ${textU} lässt sich mit ${m.u} nicht vergleichen.` };
  const t = A.ergebnis(textRoh), l = { q: m.q, v: m.v };
  const gleichZahl = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
  if (t.q === 'unklar' || l.q === 'unklar'){
    if (tidy(textRoh) === tidy(m.roh) && f === 1) return { status: 'belegt', notiz: 'Zahl gleich geschrieben wie im Prüfbericht.' };
    return { status: 'ohne', notiz: `Die Zahl ist nicht eindeutig lesbar (Prüfbericht „${m.roh}“) – nicht verglichen.` };
  }
  if (t.q !== l.q) return { status: 'abweicht', notiz: `Prüfbericht: „${m.roh} ${m.u}“.` };
  if (t.q === 'gemessen'){
    if (gleichZahl(t.v * f, l.v)) return { status: 'belegt', notiz: f !== 1 ? `umgerechnet: ${m.roh} ${m.u}` : '' };
    const d = nachkomma(textRoh), lt = l.v / f, gerundet = fmt(lt, d) === fmt(t.v, d);
    const notiz = gerundet ? `gerundet? Prüfbericht: ${m.roh}${f !== 1 ? ' ' + m.u : ''}`
      : f === 1 && ziffern(textRoh) === ziffern(m.roh) && tidy(textRoh) !== tidy(m.roh) ? `Ziffern vertauscht? Prüfbericht: ${m.roh} ${m.u}` : `Prüfbericht: ${m.roh} ${m.u}`;
    return { status: 'abweicht', notiz, gerundet };
  }
  if (t.q === 'unter'){ if (t.v === null || l.v === null || gleichZahl(t.v * f, l.v)) return { status: 'belegt', notiz: '' }; return { status: 'abweicht', notiz: `Prüfbericht: „${m.roh} ${m.u}“.` }; }
  if (t.q === 'nn') return { status: 'belegt', notiz: '' };
  return { status: 'ohne', notiz: 'nicht bestimmt (n. b.)' };
}

/* ---------- Projektdaten aufbereiten ---------- */
/** LabelKit-Datei → Proben je Nummer (PAK, Chlorid, Asbest, Sonstige – fortlaufend wie ResultKit/LabelKit) und Brandgeruchsliste. */
function labelkitProben(lk){
  const nr = new Map(), doppelt = new Set(), storniert = new Map(), brandgeruch = [];
  if (!lk) return { nr, doppelt, storniert, brandgeruch, da: false };
  const LISTEN = [['proben', 'PAK'], ['chloridProben', 'Chlorid'], ['asbestProben', 'Asbest'], ['sonstigeProben', 'Sonstige']];
  for (const [k, typ] of LISTEN) for (const p of Array.isArray(lk[k]) ? lk[k] : []){ if (!p || typeof p !== 'object') continue;
    const n = R.number(p); if (!n) continue;
    if (p.storniert){ storniert.set(n, { p, typ }); continue; }
    if (nr.has(n)) doppelt.add(n); else nr.set(n, { p, typ }); }
  for (const n of nr.keys()) storniert.delete(n);
  (Array.isArray(lk.brandgeruchProben) ? lk.brandgeruchProben : []).forEach((p, i) => brandgeruch.push({ nr: i + 1, p }));
  return { nr, doppelt, storniert, brandgeruch, da: true };
}
const lkZeile = (n, e) => e ? [`P${n}`, e.typ, tidy(e.p.z2), tidy(e.p.z3), tidy(e.p.z4), tidy(e.p.matrix), e.p.datum ? deDatum(isoAus(e.p.datum)) : ''].filter(Boolean).join(' · ') : '';

/** Daten für die Analyse aufbereiten (aus dem, was die App gelesen hat). */
function datenAufbereiten(d){
  const P = { ...d };
  P.lkp = labelkitProben(d.lk);
  P.jeProbe = new Map();
  for (const x of d.messungen || []){ const l = x.label || ''; if (!l) continue; P.jeProbe.set(l, [...(P.jeProbe.get(l) || []), x]); }
  P.konfliktProben = new Set((d.konflikte || []).flatMap(k => k.proben.map(p => String(p).toUpperCase())));
  // eigene Angaben (Projektdaten, Ordnername, LabelKit, Auftragsreferenzen) – was hier vorkommt, ist nie „anderes Projekt“
  const pj = d.pj || {};
  const eigeneTexte = [d.projekt.name, ...Object.values(pj).filter(v => typeof v === 'string'), d.lkText || '', ...(d.auftragsreferenzen || [])];
  P.eigenNorm = normText(eigeneTexte.join(' \n '));
  P.eigeneStrassen = new Set(eigeneTexte.flatMap(t => strassenIn(t).map(x => x.key)));
  P.eigeneSchaden = schadenTeile(pj.schadennummer).map(idKey).filter(k => k.length >= 4);
  P.eigeneDaten = [];
  const datum = (iso, was) => { if (/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) P.eigeneDaten.push({ iso, was }); };
  datum(isoAus(pj.schadendatum), 'Schadendatum (Projektdaten)'); datum(isoAus(pj.ortstermin), 'Ortstermin (Projektdaten)'); datum(isoAus(pj.auftragsdatum), 'Auftragsdatum (Projektdaten)');
  for (const [n, e] of P.lkp.nr) datum(isoAus(e.p.datum), `Probenahme P${n} (LabelKit)`);
  if (d.lk) datum(isoAus(d.lk.brandgeruchDatum), 'Brandgeruch-Prüfung (LabelKit)');
  for (const b of d.berichte || []) if (b.datum) datum(b.datum, `Prüfbericht ${b.code}`);
  return P;
}

/* ---------- Analyse ---------- */
const ICON = { belegt: 'ok', abweicht: 'warn', fremd: 'x', ohne: '', gewollt: 'ok' };
function analysieren(doc, d){
  const P = datenAufbereiten(d), marken = [], nichtPruefbar = [];
  const andere = andereOhneEigene(d.andere, P.eigenNorm, P.eigeneStrassen);
  const pnr = d.projekt.nr;
  const neu = (seg, von, bis, art, o) => { const m = { id: marken.length, seg: seg.id, von, bis, art, text: seg.text.slice(von, bis), abschnitt: seg.abschnitt, ...o };
    m.schluessel = [art, m.abschnitt || '', m.probe || '', normText(m.text), m.param || ''].join('|'); marken.push(m); return m; };
  const frei = (seg, von, bis) => !marken.some(m => m.seg === seg.id && m.von < bis && von < m.bis);
  const istBrandgeruch = seg => /brandgeruch/i.test(seg.titel || '');
  const kontextParam = (satz, seg, kopf) => {
    const c = /chlorid/i.test(kopf || '') || /chlorid/i.test(satz), p = /PAK|EPA|Summenwert/.test(kopf || '') || /PAK|EPA|Summenwert/.test(satz);
    if (c && !p) return 'Chlorid'; if (p && !c) return 'PAK';
    if (c && p) return '';
    if (/korrosion|chlorid/i.test(seg.titel || '')) return 'Chlorid'; if (/organisch|PAK/i.test(seg.titel || '')) return 'PAK';
    return '';
  };
  const nichtPruefbarGrund = label => {
    if (P.konfliktProben.has(label)) return 'zwei Prüfberichte für dieselbe Probe (ungeklärt, siehe ResultKit)';
    if ((d.pdfOhneXml || []).length && !d.aktuell) return 'Prüfbericht nur als PDF, ResultKit-Übernahme nicht aktuell';
    if (d.ergebnisseDa && !d.aktuell) return 'ResultKit-Übernahme nicht aktuell';
    if ((d.pdfOhneXml || []).length && !d.ergebnisseDa) return 'Prüfbericht nur als PDF, nicht in ResultKit übernommen';
    return 'noch kein Laborwert';
  };
  /* --- Probe: gibt es sie? Raum: passt er? --- */
  const probeInfo = (n, bg) => {
    if (bg){ const e = P.lkp.brandgeruch.find(x => x.nr === n); return e ? { da: true, bg: true, text: [tidy(e.p.z1), tidy(e.p.z2)].filter(Boolean).join(', '), zeile: `Brandgeruch-Probe ${n} · ${[tidy(e.p.z1), tidy(e.p.z2)].filter(Boolean).join(', ')}` } : { da: false, bg: true }; }
    const e = P.lkp.nr.get(n), l = 'P' + n;
    if (P.lkp.doppelt.has(n)) return { da: true, doppelt: true, zeile: `P${n} ist in LabelKit doppelt vergeben` };
    if (e) return { da: true, e, zeile: lkZeile(n, e), raum: tidy(e.p.z2) || tidy(e.p.raum) };
    if (P.lkp.storniert.has(n)) return { da: false, storniert: true };
    const ms = P.jeProbe.get(l); if (ms && ms.length) return { da: true, ausBericht: true, zeile: `Probe ${n} im Prüfbericht ${ms[0].bericht}`, raum: ms[0].desc };
    return { da: false };
  };
  const probeMarke = (seg, von, bis, n, bg) => {
    if (!frei(seg, von, bis)) return;
    const i = probeInfo(n, bg), probe = (bg ? 'B' : 'P') + n;
    // doppelt vergebene Nummer: nicht prüfbar – steht in der gelben Zeile oben, nie als „belegt“ (Codex, PR #1)
    if (i.doppelt){ const g = 'Probennummer in LabelKit doppelt vergeben'; nichtPruefbar.push(g); return neu(seg, von, bis, 'probe', { probe, status: 'ohne', nichtPruefbar: g, titel: `Probe ${n}`, notiz: `Nicht prüfbar: P${n} ist in LabelKit doppelt vergeben – in LabelKit klären.` }); }
    if (i.da) return neu(seg, von, bis, 'probe', { probe, status: 'belegt', titel: bg ? `Brandgeruch-Probe ${n}` : `Probe ${n}`, beleg: [[bg ? 'LabelKit' : (i.ausBericht ? 'Prüfbericht' : 'LabelKit'), i.zeile]] });
    if (!P.lkp.da) return neu(seg, von, bis, 'probe', { probe, status: 'ohne', titel: `Probe ${n}`, notiz: 'Keine LabelKit-Datei dieses Projekts – Probe nicht prüfbar.' });
    if (i.storniert) return neu(seg, von, bis, 'probe', { probe, status: 'abweicht', titel: `Probe ${n}`, befund: `P${n} ist in LabelKit storniert`, notiz: 'Im Text steht sie trotzdem.' });
    return neu(seg, von, bis, 'probe', { probe, status: 'abweicht', titel: `Probe ${n}`, befund: bg ? `Brandgeruch-Probe ${n} gibt es in LabelKit nicht` : `Probe ${n} gibt es in diesem Projekt nicht`, notiz: bg ? `LabelKit hat ${P.lkp.brandgeruch.length} Brandgeruch-Proben.` : 'Weder in LabelKit noch in einem Prüfbericht.' });
  };
  const raumMarke = (seg, von, bis, n, bg) => {
    const roh = seg.text.slice(von, bis), t = roh.replace(/,\s*Tiefe\b.*$/i, '').trim();
    if (!t || /^(Material|Referenz|Freimessung|vorläufig)\b/i.test(t) || /^(?:\p{L}*probe|P)\s*\d/iu.test(t) || !frei(seg, von, von + t.length)) return;   // „(Probe 1, Probe 2)“: keine Stelle
    const i = probeInfo(n, bg); if (!i.da || i.doppelt) return;
    const soll = bg ? i.text : i.raum; if (!soll) return;
    const k = R.beschreibungKey(t), ok = [soll, R.raumAusschreiben(soll).text].some(x => R.beschreibungKey(x) === k);
    const probe = (bg ? 'B' : 'P') + n, quelle = bg || !i.ausBericht ? 'LabelKit' : 'Prüfbericht';
    if (ok) return neu(seg, von, von + t.length, 'raum', { probe, status: 'belegt', titel: `Entnahmestelle ${bg ? 'Brandgeruch-Probe ' : 'P'}${n}`, beleg: [[quelle, i.zeile]] });
    const anders = bg ? null : [...P.lkp.nr].find(([m, e]) => m !== n && [tidy(e.p.z2), R.raumAusschreiben(e.p.z2).text].some(x => R.beschreibungKey(x) === k));
    return neu(seg, von, von + t.length, 'raum', { probe, status: 'abweicht', titel: `Entnahmestelle ${bg ? 'Brandgeruch-Probe ' : 'P'}${n}`,
      befund: `${bg ? 'Brandgeruch-Probe ' + n : 'P' + n} heißt in ${quelle} „${soll}“`, notiz: `Im Text steht „${t}“.${anders ? ` So heißt P${anders[0]}.` : ''}`, beleg: [[quelle, i.zeile]] });
  };
  /* --- Wert einer Probe --- */
  const wertMarke = (seg, von, bis, roh, u, n, param, grund) => {
    if (!frei(seg, von, bis)) return;
    const titelW = `${roh} ${u}`.replace(/\s+/g, ' ');
    if (!PRUEF_EINHEIT.test(einheitKurz(u))) return neu(seg, von, bis, 'wert', { status: 'ohne', titel: titelW, notiz: 'Eigene Angabe des Sachverständigen (keine Laboreinheit).' });
    if (n == null) return neu(seg, von, bis, 'wert', { status: 'ohne', titel: titelW, notiz: grund || 'Keiner Probe zugeordnet.' });
    const label = 'P' + n, alle = (P.jeProbe.get(label) || []).filter(x => R.CHLORID.test(x.p) || R.SUMME.test(x.p));
    const lk = probeInfo(n, false);
    const istParam = (x, p) => p === 'Chlorid' ? R.CHLORID.test(x.p) : R.SUMME.test(x.p);
    let kand = ['Chlorid', 'PAK'].filter(p => alle.some(x => istParam(x, p) && faktor(u, x.u, p) !== null));
    if (param) kand = kand.filter(p => p === param);
    if (!alle.length){
      if (!lk.da && P.lkp.da && !P.lkp.storniert.has(n)) return neu(seg, von, bis, 'wert', { probe: label, status: 'abweicht', titel: titelW, befund: `Probe ${n} gibt es in diesem Projekt nicht`, notiz: `Der Wert ${titelW} gehört zu keiner Probe.` });
      const g = nichtPruefbarGrund(label); nichtPruefbar.push(g);
      return neu(seg, von, bis, 'wert', { probe: label, status: 'ohne', titel: `${titelW} · P${n}`, nichtPruefbar: g, notiz: `Nicht prüfbar: ${g}.`, beleg: lk.zeile ? [['LabelKit', lk.zeile]] : [] });
    }
    if (kand.length !== 1){
      if (param && !kand.length) return neu(seg, von, bis, 'wert', { probe: label, status: 'abweicht', titel: `${titelW} · P${n}`, param, befund: `P${n} hat keinen ${param === 'PAK' ? 'Σ16 EPA-PAK' : 'Chlorid'}-Wert in ${u}`, notiz: `Im Prüfbericht: ${alle.map(x => `${x.p} ${x.roh} ${x.u}`).join(' · ')}`, beleg: lk.zeile ? [['LabelKit', lk.zeile]] : [] });
      return neu(seg, von, bis, 'wert', { probe: label, status: 'ohne', titel: `${titelW} · P${n}`, notiz: 'Parameter nicht eindeutig (Chlorid oder PAK?) – nicht verglichen.' });
    }
    const p = kand[0], werte = alle.filter(x => istParam(x, p) && faktor(u, x.u, p) !== null);
    const m = werte.find(x => A.einheit(x.u) === A.einheit(u)) || werte.find(x => R.FLAECHE.test(x.u)) || werte[0];
    const v = wertVergleich(roh, u, m, p), name = p === 'PAK' ? 'Σ16 EPA-PAK' : 'Chlorid';
    const beleg = [['Prüfbericht', `${m.bericht}, Probe ${n}${m.probe ? ` (Labor-Nr. ${m.probe})` : ''}: ${m.p} ${m.roh} ${m.u}${m.vorlaeufig ? ' – vorläufig' : ''}`]];
    if (lk.zeile) beleg.push(['LabelKit', lk.zeile]);
    beleg.push(['ResultKit', d.quelle === 'resultkit' ? `übernommen${d.uebernommen ? ' am ' + deDatum(String(d.uebernommen).slice(0, 10)) : ''}, Übernahme aktuell` : d.ergebnisseDa ? 'Übernahme nicht aktuell – Wert aus der XML im Ordner' : 'nichts übernommen – Wert aus der XML im Ordner']);
    const unt = (d.unterschiede || []).find(x => x.probe === label && x.p === m.p); if (unt) beleg.push(['Achtung', `in ResultKit steht noch „${unt.resultkit.roh}“ (${unt.resultkit.bericht})`]);
    return neu(seg, von, bis, 'wert', { probe: label, param: p, status: v.status, titel: `${titelW} · ${name} · P${n}`, beleg, notiz: v.notiz, gerundet: v.gerundet,
      befund: v.status === 'abweicht' ? `${name} an P${n}: im Text ${titelW}, im Prüfbericht ${m.roh} ${m.u}` : '', pdf: m.pdfName || '' });
  };

  /* --- Anlagenliste (im Bericht selbst) --- */
  const anlagenListe = new Map();
  for (const s of doc.segs){ const m = /^\s*Anlage\s+(\d{1,2})\s*:\s*([\s\S]*)$/.exec(s.text); if (m) anlagenListe.set(Number(m[1]), { text: tidy(m[2]), seg: s.id }); }

  /* --- Tabellen (BerichtKit-Ergebnistabellen und ähnlich gebaute) --- */
  const tabSegs = new Set();
  for (const b of doc.bloecke){ if (b.typ !== 'tab' || b.zeilen.length < 2) continue;
    const kopf = b.zeilen[0].map(s => tidy(s.text)), sp = re => kopf.findIndex(k => re.test(k));
    const iP = sp(/^Probe\b/i); if (iP < 0) continue;
    const iL = sp(/^Labor-?\s?Nr/i), iS = sp(/^(Entnahmestelle|Probenahmestelle|Stelle|Raum)/i);
    const iW = kopf.findIndex(k => /\[(.+)\]/.test(k) && /chlorid|PAK|EPA|summe/i.test(k));
    const uW = iW >= 0 ? /\[(.+)\]/.exec(kopf[iW])[1] : '', pW = iW >= 0 ? (/chlorid/i.test(kopf[iW]) ? 'Chlorid' : 'PAK') : '';
    for (const z of b.zeilen.slice(1)){
      const nm = /^\s*(\d{1,4})\b/.exec(z[iP] ? z[iP].text : ''); if (!nm) continue; const n = Number(nm[1]);
      for (const s of z) tabSegs.add(s.id);
      probeMarke(z[iP], nm.index + nm[0].length - nm[1].length, nm.index + nm[0].length, n, false);
      if (iS >= 0 && z[iS]){ const t = z[iS].text, a = t.length - t.trimStart().length; raumMarke(z[iS], a, t.trimEnd().length, n, false); }
      if (iL >= 0 && z[iL] && tidy(z[iL].text)){ const t = z[iL].text, a = t.length - t.trimStart().length, ms = P.jeProbe.get('P' + n) || [], lab = ms.find(x => x.probe)?.probe;
        if (lab) neu(z[iL], a, t.trimEnd().length, 'labnr', { probe: 'P' + n, status: A.norm(lab) === A.norm(t) ? 'belegt' : 'abweicht', titel: `Labor-Nr. P${n}`, beleg: [['Prüfbericht', `${ms[0].bericht}, Probe ${n}: Labor-Nr. ${lab}`]], befund: A.norm(lab) === A.norm(t) ? '' : `Labor-Nr. von P${n}: im Text ${tidy(t)}, im Prüfbericht ${lab}` }); }
      if (iW >= 0 && z[iW]){ const t = z[iW].text, roh = tidy(t);
        if (roh && /\d|n\.\s*n\.|unter\s+BG/i.test(roh) && !/^[–-]$/.test(roh)){ const a = t.indexOf(roh); wertMarke(z[iW], a, a + roh.length, roh, uW, n, pW); } }
    } }

  /* --- Absätze und übrige Zellen --- */
  for (const seg of doc.segs){
    const text = seg.text; if (!text.trim() || seg.leer) continue;
    const bg = istBrandgeruch(seg), inTab = tabSegs.has(seg.id);
    for (const sz of saetze(text)){
      const satz = text.slice(sz.von, sz.bis);
      // Probenverweise im Satz
      const refs = [];
      for (const m of satz.matchAll(PROBEN_RE)){ const l = zahlenListe(m[2]), basis = sz.von + m.index + m[0].length - m[2].length;
        refs.push({ von: sz.von + m.index, bis: sz.von + m.index + m[0].length, einzeln: l.teile.length === 1, menge: l.menge, teile: l.teile.map(x => ({ n: x.n, von: basis + x.von, bis: basis + x.bis })) }); }
      for (const m of satz.matchAll(P_RE)){ const v = sz.von + m.index; if (refs.some(r => r.von <= v && v < r.bis)) continue; const n = Number(m[1]);
        refs.push({ von: v, bis: v + m[0].length, einzeln: true, menge: new Set([n]), teile: [{ n, von: v, bis: v + m[0].length }], kurz: true }); }
      refs.sort((a, b) => a.von - b.von);
      const proben = new Set(refs.flatMap(r => [...r.menge]));
      if (!inTab) for (const r of refs){
        if (r.einzeln) probeMarke(seg, r.von, r.bis, r.teile[0].n, bg);
        else for (const t of r.teile) probeMarke(seg, t.von, t.bis, t.n, bg);
        if (!r.einzeln) continue;
        const n = r.teile[0].n, nach = text.slice(r.bis);
        let m = /^\s*\(([^()\n]*)\)/.exec(nach);
        if (m){ const a = r.bis + nach.indexOf('(') + 1; raumMarke(seg, a + (m[1].length - m[1].trimStart().length), a + m[1].trimEnd().length, n, bg); continue; }
        m = /^,\s*([^()\n]*)\)/.exec(nach); const vor = text.slice(0, r.von);
        if (m && /\(\s*$/.test(vor)){ const a = r.bis + nach.indexOf(m[1]); raumMarke(seg, a, a + m[1].trimEnd().length, n, bg); }
      }
      // Werte mit Einheit
      for (const m of satz.matchAll(WERT_RE)){
        const von = sz.von + m.index, bis = von + m[0].length; if (!frei(seg, von, bis)) continue;
        const roh = (m[1] ? m[1] + ' ' : '') + m[2], u = m[3];
        // Spanne („zwischen 4,1 und 12,3 µg/cm²“, „5 bis 10 µg/cm²“, „4,1–12,3 µg/cm²“): Grenzen sind keine Messwerte (Codex, PR #1)
        const vorT = text.slice(sz.von, von), nachT = text.slice(bis);
        const obereGrenze = /(?:zwischen|von)\s+[<>]?\s*[\d.,]+[^\d]{0,14}?\s*(?:und|bis)\s*$/i.test(vorT) || SPANNE_VOR.test(vorT);
        const untereGrenze = /^\s*(?:bis|–|—|-)\s*[<>]?\s*\d/.test(nachT) || /(?:zwischen|von)\s*$/i.test(vorT) && /^\s*(?:und|bis)\s*[<>]?\s*\d/.test(nachT);
        if (obereGrenze || untereGrenze){ neu(seg, von, bis, 'wert', { status: 'ohne', titel: `${roh} ${u}`, notiz: 'Grenze einer Spanne – Spannen werden nicht geprüft.' }); continue; }
        if (bg && !inTab){ neu(seg, von, bis, 'wert', { status: 'ohne', titel: `${roh} ${u}`, notiz: 'Brandgeruch-Prüfung – keine Laborwerte.' }); continue; }
        const nach = text.slice(bis), dicht = /^\s*(?:\(\s*Probe\s+(\d{1,4})|in\s+(?:der\s+)?(?:\p{L}*probe|Probe)\s+(\d{1,4}))/u.exec(nach);
        // folgt nach der Nummer eine weitere Probe („, Probe 2“, „, 2“, „P2“, „und“, „bis“, „sowie“, „/“), ist die Zuordnung nicht eindeutig
        const weitere = dicht && /^\s*(?:[,;\/]\s*(?:\p{L}*probe\s+|P)?\d|und\b|bis\b|sowie\b|oder\b|&)/iu.test(nach.slice(dicht[0].length));
        let n = null, grund = '';
        if (dicht && !weitere) n = Number(dicht[1] || dicht[2]);
        else if (dicht) grund = 'Mehrere Proben – die Zahl lässt sich nicht sicher einer Probe zuordnen.';
        else if (proben.size === 1 && !grund) n = [...proben][0];
        else if (grund) {}
        else if (proben.size > 1) grund = 'Mehrere Proben im Satz – die Zahl lässt sich nicht sicher einer Probe zuordnen.';
        else grund = 'Keiner Probe zugeordnet.';
        wertMarke(seg, von, bis, roh, u, n, kontextParam(satz, seg), grund);
      }
    }
    if (inTab) continue;
    // Prüfberichtsnummern
    for (const m of text.matchAll(PB_RE)){ const von = m.index, bis = von + m[0].length; if (!frei(seg, von, bis)) continue; pruefberichtMarke(seg, von, bis, m[1]); }
    // Anlagen
    if (!/^\s*Anlage\s+\d{1,2}\s*:/.test(text)) for (const m of text.matchAll(ANL_RE)){ const l = zahlenListe(m[1]), basis = m.index + m[0].length - m[1].length;
      for (const t of l.teile){ const von = l.teile.length === 1 ? m.index : basis + t.von, bis = basis + t.bis; if (frei(seg, von, bis)) anlageMarke(seg, von, bis, t.n, l.teile.length, l.teile.indexOf(t)); } }
    // Datumsangaben
    for (const m of text.matchAll(DATUM_RE)){ const von = m.index, bis = von + m[0].length; if (frei(seg, von, bis)) datumMarke(seg, von, bis, ISO(m[1], m[2], m[3])); }
    // Projektnummern
    for (const m of text.matchAll(PNR_RE)){ const von = m.index, bis = von + m[1].length; if (!frei(seg, von, bis)) continue;
      if (m[1] === pnr) neu(seg, von, bis, 'projektnr', { status: 'belegt', titel: `Projektnummer ${m[1]}`, beleg: [['Projektordner', d.projekt.name]] });
      else if (andere && andere.nr.has(m[1])) neu(seg, von, bis, 'projektnr', { status: 'fremd', titel: `Projektnummer ${m[1]}`, befund: `„${m[1]}“ ist Projekt ${andere.nr.get(m[1])}`, notiz: `Dieses Projekt ist ${pnr}.`, beleg: [['Archiv', andere.nr.get(m[1])]] }); }
    // Schaden-Nr.
    schadenMarken(seg);
    // Straßen
    for (const x of strassenIn(text)){ if (!frei(seg, x.von, x.bis) || BUERO.strassen.has(x.key)) continue;
      if (P.eigeneStrassen.has(x.key)) { neu(seg, x.von, x.bis, 'adresse', { status: 'belegt', titel: x.text, beleg: [['Projektdaten', tidy((d.pj || {}).objekt) || d.projekt.name]] }); continue; }
      const fr = andere && andere.strassen.get(x.key);
      if (fr) neu(seg, x.von, x.bis, 'adresse', { status: 'fremd', titel: `„${x.text}“`, befund: `„${x.text}“ gehört zu ${fr[0].name}`, notiz: `Steht im Archiv bei ${fr.map(f => f.name).join(', ')}. In diesem Projekt kommt die Adresse nicht vor.`, beleg: fr.map(f => ['Archiv', `${f.name}: ${f.text}`]) });
      else neu(seg, x.von, x.bis, 'adresse', { status: 'ohne', titel: x.text, notiz: 'Adresse steht weder in diesem noch in einem anderen Projekt.' }); }
    // Namen (Auftraggeber, VN, Versicherer) anderer Projekte
    if (andere && andere.namen.length){ const nm = normMitMap(text);
      for (const f of andere.namen){ let i = -1;
        while ((i = nm.s.indexOf(f.norm, i + 1)) >= 0){ const vorC = nm.s[i - 1] || ' ', nachC = nm.s[i + f.norm.length] || ' ';
          if (/[\p{L}\d]/u.test(vorC) || /[\p{L}\d]/u.test(nachC)) continue;
          const von = nm.map[i], bis = nm.map[i + f.norm.length - 1] + 1; if (!frei(seg, von, bis)) continue;
          neu(seg, von, bis, 'name', { status: 'fremd', titel: `„${text.slice(von, bis)}“`, befund: `„${text.slice(von, bis)}“ ist ${f.feld} in ${f.name}`, notiz: 'In den Daten dieses Projekts kommt der Name nicht vor.', beleg: [['Archiv', `${f.name}: ${f.feld} ${f.text}`]] }); } } }
  }

  function pruefberichtMarke(seg, von, bis, code){
    const fa = A.berichtsFassung(code), alle = d.berichte || [], titel = `Prüfbericht ${code}`;
    const gleich = alle.filter(b => A.norm(b.code) === A.norm(code)), sel = gleich[0];
    const neuere = alle.filter(b => b.fassung !== null && fa.fassung !== null && b.grund === fa.grund && b.fassung > fa.fassung).sort((a, b) => b.fassung - a.fassung);
    const ersetzt = (d.ersetzt || []).some(c => A.norm(c) === A.norm(code));
    if (sel && sel.fremd) return neu(seg, von, bis, 'pruefbericht', { status: 'abweicht', titel, befund: `Prüfbericht ${code} nennt Projekt ${sel.fremd}`, notiz: `Auftragsreferenz „${sel.ref}“ – seine Werte zählen hier nicht.` });
    if (neuere.length || ersetzt){ const n = neuere[0];
      return neu(seg, von, bis, 'pruefbericht', { status: 'abweicht', titel, befund: `Prüfbericht ${code.slice(-3)} ist überholt`, notiz: n ? `Im Projektordner liegt die Fassung ${n.code}.` : 'ResultKit führt ihn als ersetzt.', beleg: n ? [['Laborergebnisse', `${n.code}${n.datei ? ` (${n.datei})` : ''}`]] : [] }); }
    if (sel) return neu(seg, von, bis, 'pruefbericht', { status: 'belegt', titel, beleg: [['Laborergebnisse', `${sel.code}${sel.datei ? ` (${sel.datei})` : ''}${sel.vorlaeufig ? ' – vorläufig' : ''}${sel.quelle === 'resultkit' ? ' · in ResultKit übernommen' : ''}`]], pdf: sel.pdf || '' });
    // ganze Nummer im Dateinamen, keine längere („…-30“ ist nicht „…-300“, „…-01“ nicht „…-01-02“) – Codex, PR #1
    const strich = s => String(s).normalize('NFC').replace(/[\u2010-\u2015\u2212]/g, '-').toUpperCase(), cn = strich(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pdf = (d.pdfNamen || []).find(n => new RegExp(`(?<![A-Z0-9-])${cn}(?!-?[A-Z0-9])`).test(strich(n)));
    if (pdf) return neu(seg, von, bis, 'pruefbericht', { status: 'belegt', titel, beleg: [['Laborergebnisse', `PDF „${pdf}“ (Nummer nur im Dateinamen)`]], pdf });
    if (alle.length) return neu(seg, von, bis, 'pruefbericht', { status: 'abweicht', titel, befund: `Prüfbericht ${code} liegt nicht in „Laborergebnisse“`, notiz: `Im Ordner: ${[...new Set(alle.map(b => b.code))].join(', ')}.` });
    nichtPruefbar.push('kein Prüfbericht lesbar');
    return neu(seg, von, bis, 'pruefbericht', { status: 'ohne', titel, nichtPruefbar: 'kein Prüfbericht lesbar', notiz: 'Nicht prüfbar: in „Laborergebnisse“ ist kein Prüfbericht lesbar.' });
  }
  function anlageMarke(seg, von, bis, n, anzahl, index){
    if (!anlagenListe.size) return neu(seg, von, bis, 'anlage', { status: 'ohne', titel: `Anlage ${n}`, notiz: 'Der Bericht hat keine Anlagenliste – nicht prüfbar.' });
    const e = anlagenListe.get(n);
    if (!e) return neu(seg, von, bis, 'anlage', { status: 'abweicht', titel: `Anlage ${n}`, befund: `Anlage ${n} steht nicht in der Anlagenliste`, notiz: `Liste: ${[...anlagenListe.keys()].sort((a, b) => a - b).map(k => 'Anlage ' + k).join(', ')}.` });
    // Satz: welcher Gegenstand wird mit dieser Anlage verbunden?
    const sz = saetze(seg.text).find(x => x.von <= von && von < x.bis), satz = seg.text.slice(sz.von, sz.bis);
    const codes = [...satz.matchAll(PB_RE)].map(m => m[1]);
    let erwartet = '';
    if (codes.length && codes.length === anzahl) erwartet = codes[index];
    else if (anzahl === 1 && codes.length === 1) erwartet = codes[0];
    const vor = seg.text.slice(Math.max(sz.von, von - 60), von);
    const art = /Bilddokumentation[^()]*\($/.test(vor) ? 'Bilddokumentation' : /Probenplan[^()]*\($/.test(vor) ? 'Probenplan' : /Brandgeruch/i.test(satz) && !codes.length ? 'Brandgeruch' : '';
    const beleg = [['Anlagenliste', `Anlage ${n}: ${e.text}`]];
    if (erwartet && !A.norm(e.text).includes(A.norm(erwartet))) return neu(seg, von, bis, 'anlage', { status: 'abweicht', titel: `Anlage ${n}`, befund: `Anlage ${n} ist laut Liste nicht ${erwartet}`, notiz: `Anlagenliste: „${e.text}“.`, beleg });
    if (art && !new RegExp(art, 'i').test(e.text)) return neu(seg, von, bis, 'anlage', { status: 'abweicht', titel: `Anlage ${n}`, befund: `Anlage ${n} ist laut Liste nicht die ${art}`, notiz: `Anlagenliste: „${e.text}“.`, beleg });
    return neu(seg, von, bis, 'anlage', { status: 'belegt', titel: `Anlage ${n}`, beleg });
  }
  function datumMarke(seg, von, bis, iso){
    const vor = seg.text.slice(Math.max(0, von - 45), von), nach = seg.text.slice(bis, bis + 60), titel = `Datum ${deDatum(iso)}`;
    let rolle = '';
    if (/Schaden vom:\s*$/.test(vor) || /Brandschaden vom\s*$/.test(vor) || /(?:^|\s)Am\s*$/.test(vor) && /^\s*kam es/.test(nach)) rolle = 'schadendatum';
    else if (/(?:^|\s)[Aa]m\s*$/.test(vor) && /^\s*wurde unser Büro/.test(nach)) rolle = 'auftragsdatum';
    else if (/(?:^|\s)am\s*$/.test(vor) && /^\s*sensorisch auf Brandgeruch/.test(nach)) rolle = 'brandgeruch';
    else if (/(?:fand|fanden)\s+(?:eine\s+)?Besichtigung/.test(seg.text.slice(von)) && /(?:^|\s)(?:[Aa]m|und am)\s*$/.test(vor)) rolle = 'ortstermin';
    else if (/(Sanierungsvorschlag|Untersuchungsbericht|Bericht|Mitteilung|Gutachten)\s+vom\s*$/.test(vor) || /^\s*\p{Lu}[\p{L} .\-]*,\s*$/u.test(seg.text.slice(0, von)) && !nach.trim())
      return neu(seg, von, bis, 'datum', { status: 'ohne', titel, notiz: 'Datum des Berichts.' });
    const pj = d.pj || {};
    if (rolle){
      const quellen = rolle === 'schadendatum' ? [['Projektdaten', 'Schadendatum', isoAus(pj.schadendatum)]] : rolle === 'auftragsdatum' ? [['Projektdaten', 'Auftragsdatum', isoAus(pj.auftragsdatum)]]
        : rolle === 'brandgeruch' ? [['LabelKit', 'Brandgeruch-Prüfung', isoAus(d.lk && d.lk.brandgeruchDatum)]]
        : [['Projektdaten', 'Ortstermin', isoAus(pj.ortstermin)], ...[...P.lkp.nr].map(([n, e]) => ['LabelKit', `Probenahme P${n}`, isoAus(e.p.datum)])];
      const da = quellen.filter(q => q[2]);
      if (!da.length) return neu(seg, von, bis, 'datum', { status: 'ohne', titel, notiz: `Kein ${quellen[0][1]} in den Daten – nicht prüfbar.` });
      const ok = da.filter(q => q[2] === iso);
      if (ok.length) return neu(seg, von, bis, 'datum', { status: 'belegt', titel, beleg: [[ok[0][0], `${ok[0][1]}: ${deDatum(iso)}${ok.length > 1 ? ` (und ${ok.length - 1} weitere)` : ''}`]] });
      const soll = [...new Set(da.map(q => q[2]))];
      return neu(seg, von, bis, 'datum', { status: 'abweicht', titel, befund: `${quellen[0][1]}: im Text ${deDatum(iso)}, in den Daten ${soll.map(deDatum).join(' / ')}`, beleg: da.slice(0, 3).map(q => [q[0], `${q[1]}: ${deDatum(q[2])}`]) });
    }
    const passt = P.eigeneDaten.filter(x => x.iso === iso);
    if (passt.length) return neu(seg, von, bis, 'datum', { status: 'belegt', titel, beleg: passt.slice(0, 4).map(x => ['Daten', x.was]) });
    return neu(seg, von, bis, 'datum', { status: 'ohne', titel, notiz: 'Datum steht in keiner Projektdatei.' });
  }
  function schadenMarken(seg){
    const text = seg.text, pj = d.pj || {}, eigen = schadenTeile(pj.schadennummer);
    const lab = /Schaden-?\s?Nr\.?\s*:?[\t ]*([^\t\n]+?)\s*$/m.exec(text);
    if (lab){ const v = lab[1].trim(), von = lab.index + lab[0].lastIndexOf(v), bis = von + v.length;
      if (v && frei(seg, von, bis) && !/^\[/.test(v)){
        if (eigen.some(e => idKey(e) === idKey(v))) neu(seg, von, bis, 'schadennr', { status: 'belegt', titel: `Schaden-Nr. ${v}`, beleg: [['Projektdaten', `Schaden-Nr. ${pj.schadennummer}`]] });
        else { const fr = andere && andere.schaden.get(idKey(v));
          if (fr) neu(seg, von, bis, 'schadennr', { status: 'fremd', titel: `Schaden-Nr. ${v}`, befund: `Schaden-Nr. „${v}“ gehört zu ${fr[0].name}`, notiz: eigen.length ? `In diesem Projekt: ${eigen.join(', ')}.` : 'In diesem Projekt ist keine Schaden-Nr. eingetragen.', beleg: fr.map(f => ['Archiv', `${f.name}: ${f.text}`]) });
          else if (eigen.length) neu(seg, von, bis, 'schadennr', { status: 'abweicht', titel: `Schaden-Nr. ${v}`, befund: `Schaden-Nr.: im Text ${v}, in den Projektdaten ${eigen.join(' / ')}`, beleg: [['Projektdaten', `Schaden-Nr. ${pj.schadennummer}`]] });
          else neu(seg, von, bis, 'schadennr', { status: 'ohne', titel: `Schaden-Nr. ${v}`, notiz: 'In den Projektdaten ist keine Schaden-Nr. eingetragen.' }); } } }
    for (const m of text.matchAll(ID_RE)){ const v = m[1]; if (!/\d/.test(v)) continue; const k = idKey(v); if (k.length < 5) continue;
      const von = m.index, bis = von + v.length; if (!frei(seg, von, bis)) continue;
      if (P.eigeneSchaden.includes(k)) { neu(seg, von, bis, 'schadennr', { status: 'belegt', titel: `Schaden-Nr. ${v}`, beleg: [['Projektdaten', `Schaden-Nr. ${pj.schadennummer}`]] }); continue; }
      const fr = andere && andere.schaden.get(k);
      if (fr && !P.eigenNorm.includes(normText(v))) neu(seg, von, bis, 'schadennr', { status: 'fremd', titel: `„${v}“`, befund: `„${v}“ ist die Schaden-Nr. von ${fr[0].name}`, notiz: 'In diesem Projekt kommt die Nummer nicht vor.', beleg: fr.map(f => ['Archiv', `${f.name}: Schaden-Nr. ${f.text}`]) }); }
  }

  /* --- „Ist so gewollt“ anwenden, zählen --- */
  const gewollt = new Map((d.gewollt || []).map(g => [g.schluessel, g]));
  for (const m of marken){ m.icon = ICON[m.status]; if ((m.status === 'abweicht' || m.status === 'fremd') && gewollt.has(m.schluessel)) m.gewollt = gewollt.get(m.schluessel); }
  const z = { belegt: 0, abweicht: 0, fremd: 0, ohne: 0, gewollt: 0 };
  for (const m of marken){ if (m.gewollt) z.gewollt++; else z[m.status]++; }
  const np = new Map(); for (const m of marken) if (m.nichtPruefbar) np.set(m.nichtPruefbar, (np.get(m.nichtPruefbar) || 0) + 1);
  marken.sort((a, b) => a.seg - b.seg || a.von - b.von); marken.forEach((m, i) => { m.id = i; });   // Nummer = Platz in der Liste (Oberfläche greift über die Nummer zu)
  return { marken, zaehler: z, nichtPruefbar: [...np].map(([grund, n]) => ({ grund, n })), anlagenListe: [...anlagenListe] };
}

/** Andere Projekte → Suchindex. eintraege: [{ name, nr, pj | null }] (pj null = nur Ordnername). */
function andereIndex(eintraege, eigeneNr){
  const nr = new Map(), strassen = new Map(), schaden = new Map(), namen = [];
  const dazu = (map, k, w) => { const l = map.get(k) || []; if (!l.some(x => x.name === w.name)) l.push(w); map.set(k, l); };
  let voll = 0, nurName = 0;
  for (const e of eintraege){ if (!e || !e.nr || e.nr === eigeneNr) continue;
    if (e.pj) voll++; else nurName++;
    if (!nr.has(e.nr)) nr.set(e.nr, e.name);
    const texte = [e.name, ...(e.pj ? [e.pj.objekt, e.pj.schadenort, e.pj.versicherungsnehmer, e.pj.auftraggeber] : [])];
    for (const t of texte) for (const x of strassenIn(t)) if (!BUERO.strassen.has(x.key)) dazu(strassen, x.key, { name: e.name, text: x.text });
    if (e.pj){
      for (const t of schadenTeile(e.pj.schadennummer)){ const k = idKey(t); if (k.length >= 5 && /\d/.test(k)) dazu(schaden, k, { name: e.name, text: t }); }
      for (const [feld, wert] of [['Auftraggeber', e.pj.auftraggeber], ['Versicherungsnehmer', e.pj.versicherungsnehmer], ['Versicherer', e.pj.versicherer]]){
        const erste = tidy(String(wert || '').split(/\n|,(?=\s*\S*\d)/)[0]), n = normText(erste);
        if (n.length < 10 || BUERO.namen.some(b => n.includes(b)) || /^(unbekannt|privat|-+)$/.test(n)) continue;
        namen.push({ norm: n, text: erste, feld, name: e.name }); } } }
  return { nr, strassen, schaden, namen, voll, nurName, gelesen: voll + nurName };
}
/** Namen und Straßen, die auch in diesem Projekt vorkommen, aus dem Index nehmen („nirgends in diesem Projekt“). */
function andereOhneEigene(idx, eigenNorm, eigeneStrassen){
  if (!idx) return idx;
  return { ...idx, namen: idx.namen.filter(f => !eigenNorm.includes(f.norm)), strassen: new Map([...idx.strassen].filter(([k]) => !eigeneStrassen.has(k))) };
}

const api = Object.freeze({ VERSION, docxLesen, teilBloecke, absatzText, analysieren, andereIndex, andereOhneEigene, datenAufbereiten, wertVergleich, faktor, saetze, zahlenListe,
  strassenIn, strassenKey, idKey, normText, isoAus, deDatum, labelkitProben, WERT_RE, BUERO });
root.LektorKern = api;
})(typeof window !== 'undefined' ? window : globalThis);
