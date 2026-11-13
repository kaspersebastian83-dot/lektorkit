#!/usr/bin/env node
// LektorKit prüfen: node tests/lektorkit-check.cjs [a|b|…|alle]   (nur erfundene Daten)
// Braucht Playwright mit Chromium (NODE_PATH, PLAYWRIGHT_BROWSERS_PATH) und für Prüfung a die Nachbar-Repos
// ../projektzentrale, ../resultkit, ../berichtkit (oder PROJEKTZENTRALE, RESULTKIT, BERICHTKIT). Bildschirmfotos nach tests/out/.
//  a  Kopien: spektron-ordner.js, archiv/auswertung.js, word-luecken.js byte-gleich; xmlLesen wörtlich; Regeln aus ResultKit/BerichtKit gleich
//  b  echter BerichtKit-Brandbericht (BR1), alles passt → keine Abweichung, nichts aus anderem Projekt, nichts nicht prüfbar
//  c  Zahlendreher (Tabelle 2300 → 3200, Text 12,3 → 13,2)
//  d  falscher Raumname (Tabelle „EG Flur Wand“ → „EG Bad Wand“)
//  e  überholte Prüfberichtsfassung (-01 im Text, -02 im Ordner)
//  f  Straße eines anderen Projekts; Zählung „mit Projektdaten / nur Ordnername“; Büroadresse, Ort, eigene Adresse nie
//  g  ein Satz mit zwei Proben und einem Wert → „ohne Beleg“, zählt nicht als Problem
//  h  von Hand geschriebener Bericht ohne BerichtKit-Aufbau; „Ist so gewollt“ mit Kürzel und Datum; Gerundet-Hinweis
//  i  Bericht und alle Projektdateien nach einem Lauf byte-gleich; alte Projekte bekommen nie „_Spektron“
//  j  nicht prüfbar (Prüfbericht nur als PDF, Übernahme nicht aktuell) → Zeile oben mit Zahl und Grund, kein sauberes Ergebnis
//  k  Prüfprotokoll: eine Seite
//  l  Codex-Befunde PR #1: fehlender Bericht (Link, neu einlesen) → nichts lesen; alte Übernahme mit gelöschter -02 macht -01 nicht
//     „überholt“; zwei Projekte schnell nacheinander → das letzte gilt; doppelte Kopftabelle nur einmal
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'out');
const NACHBAR = (env, name) => path.resolve(process.env[env] || path.join(ROOT, '..', name));
const was = process.argv[2] || 'alle';
let ok = 0; const fall = async (k, name, fn) => { if (was !== 'alle' && !was.split(',').includes(k)) return; await fn(); ok++; console.log(`ok ${k} – ${name}`); };

/* ---------- ZIP (docx) lesen und schreiben ---------- */
function zipLesen(buf){
  const out = {}, eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0, k = buf.readUInt16LE(eocd + 10); i < k; i++){
    const methode = buf.readUInt16LE(p + 10), groesse = buf.readUInt32LE(p + 20), lName = buf.readUInt16LE(p + 28), ofs = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + lName), start = ofs + 30 + buf.readUInt16LE(ofs + 26) + buf.readUInt16LE(ofs + 28), daten = buf.subarray(start, start + groesse);
    out[name] = methode === 8 ? zlib.inflateRawSync(daten) : Buffer.from(daten);
    p += 46 + lName + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipSchreiben(teile){
  const lokal = [], zentral = []; let ofs = 0;
  for (const [name, inhalt] of Object.entries(teile)){
    const n = Buffer.from(name), d = Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(inhalt), c = crc32(d);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(c, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    const z = Buffer.alloc(46); z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6); z.writeUInt32LE(c, 16); z.writeUInt32LE(d.length, 20); z.writeUInt32LE(d.length, 24); z.writeUInt16LE(n.length, 28); z.writeUInt32LE(ofs, 42);
    lokal.push(h, n, d); zentral.push(z, n); ofs += 30 + n.length + d.length;
  }
  const zl = Buffer.concat(zentral), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(zentral.length / 2, 8); e.writeUInt16LE(zentral.length / 2, 10); e.writeUInt32LE(zl.length, 12); e.writeUInt32LE(ofs, 16);
  return Buffer.concat([...lokal, zl, e]);
}
/** Text im Haupttext der Word-Datei ersetzen (jede Stelle muss genau einmal vorkommen). */
function docxErsetzen(buf, paare){
  const t = zipLesen(buf); let x = t['word/document.xml'].toString('utf8');
  for (const [alt, neu] of paare){ const n = x.split(alt).length - 1; assert.equal(n, 1, `„${alt}“ kommt ${n}× im Bericht vor`); x = x.replace(alt, neu); }
  t['word/document.xml'] = Buffer.from(x); return zipSchreiben(t);
}
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Von Hand geschriebener Bericht: nur Absätze (Zeilen), ohne Tabellen, Kopfzeilen und BerichtKit-Aufbau. */
function docxVonHand(zeilen){
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const body = zeilen.map(z => `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(z)}</w:t></w:r></w:p>`).join('');
  return zipSchreiben({ '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>` });
}
/** Eurofins-XML (AnalyticalReport), so weit xmlLesen sie liest. */
function euroXml(code, { vorlaeufig = false, ref = '99.9002 Beispielstadt', proben }){
  return `<?xml version="1.0" encoding="utf-8"?><AnalyticalReport AnalyticalReportCode="${code}" IsPreliminaryReport="${vorlaeufig}"><SignatureOn>2026-10-20T10:00:00Z</SignatureOn><Batches><Batch><ClientPurchaseOrderReference>${xmlEsc(ref)}</ClientPurchaseOrderReference><BatchCode>B1</BatchCode><Samples>` +
    proben.map(p => `<SamplePartner><SamplePartnerCode>${p.labNr}</SamplePartnerCode><Description>${xmlEsc(p.ref)}</Description><Matrix>Wischprobe</Matrix><SamplingDate>2026-10-14</SamplingDate><AdditionalFields Name="SPLPT_NAME"><Value>${xmlEsc(p.desc || '')}</Value></AdditionalFields><Lines>` +
      (p.werte || []).map(w => `<AnalyticalReportLine><ParameterName>${xmlEsc(w.p)}</ParameterName><Result>${xmlEsc(w.r)}</Result><Unit>${xmlEsc(w.u)}</Unit><LOQ>${xmlEsc(w.loq || '')}</LOQ></AnalyticalReportLine>`).join('') + '</Lines></SamplePartner>').join('') +
    '</Samples></Batch></Batches></AnalyticalReport>';
}

/* ---------- Testprojekt aus der BerichtKit-Vorlage ---------- */
const BR1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'berichtkit-br1.json'), 'utf8'));
const BR1_DOCX = fs.readFileSync(path.join(__dirname, 'fixtures', 'berichtkit-br1.docx'));
const BERICHT = '1._Mitteilung_99.9002_Entwurf.docx';
const ANDERE = {
  '99.9001 Lindenweg Anderort Tst': { '_Spektron/_Projekt.json': { format: 'mosaik-projekt', version: 1, projektnummer: '99.9001', objekt: 'Lindenweg 4, 11111 Anderort', auftraggeber: 'Andere Hausverwaltung Nord KG, Postweg 2, 11111 Anderort', schadennummer: 'AH-2025-777' } },
  '99.8000 Altbau Irgendwo Tst': {},   // nur Ordnername, keine Projektdaten
  '99.7000 Kasernenstr. 9 Weitweg Tst': {},   // nur Ordnername, mit Hausnummer im Namen
};
/** Dateien eines Projekts: { pfad: Inhalt }. erg ohne Stand – den setzt der Browser nach dem Anlegen (wie ResultKit). */
function br1Dateien({ docx = BR1_DOCX, xml = true, erg = true, pdf = true, extraXml = {} } = {}){
  const d = { '_Spektron/_Projekt.json': BR1.pj, '_Spektron/LabelKit/99.9002_Daten.json': BR1.lk, ['Mitteilungen/' + BERICHT]: docx, 'Mitteilungen/99-9002_Anlage_Brandgeruch_2026-10-21.docx': docxVonHand(['Anlage']) };
  for (const b of BR1.erg.berichte){
    if (xml) d['Laborergebnisse/' + b.bericht + '.xml'] = euroXml(b.bericht, { proben: b.proben.map(p => ({ ref: p.ref, labNr: p.labNr, werte: p.werte })) });
    if (pdf) d['Laborergebnisse/' + b.bericht + '.pdf'] = '%PDF-1.4 erfunden';
  }
  Object.assign(d, extraXml);
  if (erg) d['_Spektron/ResultKit/_Ergebnisse.json'] = { ...BR1.erg, uebernommen: '2026-10-21T08:00:00.000Z', vollstaendig: true, stand: '@STAND@', dateien: [] };
  return d;
}

/* ---------- Browser ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png' };
function server(){ return new Promise(ok => { const s = http.createServer((q, a) => { const p = path.join(ROOT, decodeURIComponent(q.url.split(/[?#]/)[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ a.writeHead(404); a.end(); return; } a.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); a.end(fs.readFileSync(p)); });
  s.listen(0, '127.0.0.1', () => ok(s)); }); }
let browser, page, srv, fehler = [];
async function start(){
  const { chromium } = require('playwright');
  srv = await server(); browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  page = await ctx.newPage(); page.on('pageerror', e => fehler.push(String(e))); page.on('console', m => { if (m.type() === 'error') fehler.push(m.text()); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`);
}
const b64 = v => (Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : JSON.stringify(v, null, 1))).toString('base64');
/** OPFS leeren und Archiv anlegen: projekte = { Ordnername: { pfad: Inhalt } }; archivDateien = { Name: Inhalt } */
async function archivAnlegen(projekte, archivDateien = {}){
  const liste = [];
  for (const [p, dateien] of Object.entries(projekte)) for (const [f, v] of Object.entries(dateien)) liste.push(['Archiv/' + p + '/' + f, b64(v)]);
  for (const [f, v] of Object.entries(archivDateien)) liste.push(['Archiv/' + f, b64(v)]);
  for (const p of Object.keys(projekte)) liste.push(['Archiv/' + p + '/', '']);
  await page.evaluate(async liste => {
    const root = await navigator.storage.getDirectory();
    for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true });
    for (const [weg, inhalt] of liste){ const teile = weg.split('/'), name = teile.pop(); let d = root; for (const t of teile) d = await d.getDirectoryHandle(t, { create: true });
      if (!name) continue; const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(Uint8Array.from(atob(inhalt), c => c.charCodeAt(0))); await w.close(); }
    // ResultKit-Stand wie ResultKit: XML/PDF direkt in „Laborergebnisse“ + LabelKit-Datei (Name als „Laboraufträge/…“)
    const archiv = await root.getDirectoryHandle('Archiv');
    for await (const [pn, pd] of archiv.entries()){ if (pd.kind !== 'directory') continue;
      let erg = null; try{ erg = await (await (await pd.getDirectoryHandle('_Spektron')).getDirectoryHandle('ResultKit')).getFileHandle('_Ergebnisse.json'); }catch(e){ continue; }
      const text = await (await erg.getFile()).text(); if (!text.includes('@STAND@')) continue;
      const stand = []; try{ for await (const [n, h] of (await pd.getDirectoryHandle('Laborergebnisse')).entries()) if (h.kind === 'file' && /\.(xml|pdf)$/i.test(n)){ const f = await h.getFile(); stand.push({ name: n, size: f.size, t: f.lastModified }); } }catch(e){}
      try{ for await (const [n, h] of (await (await pd.getDirectoryHandle('_Spektron')).getDirectoryHandle('LabelKit')).entries()) if (/_Daten\.json$/.test(n)){ const f = await h.getFile(); stand.push({ name: 'Laboraufträge/' + n, size: f.size, t: f.lastModified }); } }catch(e){}
      const w = await erg.createWritable(); await w.write(text.replace('"@STAND@"', JSON.stringify(ArchivAuswertung.standKennung(stand)))); await w.close(); }
  }, liste);
}
/** Projekt öffnen wie aus der Projektzentrale (Archiv aus dem Browser), Bericht lesen, Ergebnis holen. */
async function pruefen(projekt, bericht = 'Mitteilungen/' + BERICHT, mitArchiv = true){
  return page.evaluate(async ([projekt, bericht, mitArchiv]) => {
    const root = await navigator.storage.getDirectory(), archiv = await root.getDirectoryHandle('Archiv'), dir = await archiv.getDirectoryHandle(projekt);
    await LektorKitTest.oeffnen(dir, mitArchiv ? archiv : null, bericht); await LektorKitTest.warteAndere();
    const S = LektorKitTest.zustand();
    return { zaehler: S.erg.zaehler, nichtPruefbar: S.erg.nichtPruefbar, kopf: document.getElementById('kopfzeile').textContent, zeilen: [...document.querySelectorAll('#uebersicht .zeile')].map(x => ({ k: x.className, t: x.textContent })),
      marken: S.erg.marken.map(m => ({ id: m.id, art: m.art, status: m.status, text: m.text, probe: m.probe || '', param: m.param || '', befund: m.befund || '', notiz: m.notiz || '', abschnitt: m.abschnitt || '', np: m.nichtPruefbar || '', gewollt: !!m.gewollt })),
      befunde: [...document.querySelectorAll('#befunde .befund')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) };
  }, [projekt, bericht, mitArchiv]);
}
/** Dateiablage als Fingerabdruck: Pfad → SHA-256, Größe, Änderungszeit. */
const ablage = () => page.evaluate(async () => {
  const out = {}, root = await navigator.storage.getDirectory();
  const lauf = async (d, p) => { for await (const [n, h] of d.entries()){ if (h.kind === 'directory') await lauf(h, p + n + '/'); else { const f = await h.getFile(), b = await f.arrayBuffer();
    out[p + n] = [[...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join(''), f.size, f.lastModified].join(' '); } } };
  await lauf(root, ''); return out; });
const finde = (r, art, text, status) => r.marken.filter(m => m.art === art && m.text === text && (!status || m.status === status));
const offen = r => r.marken.filter(m => (m.status === 'abweicht' || m.status === 'fremd') && !m.gewollt);
const zeig = r => r.marken.filter(m => m.status !== 'belegt').map(m => `${m.status} ${m.art} „${m.text}“ ${m.befund || m.notiz}`).join('\n');
const schuss = async name => { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false }); };

(async () => {
  await fall('a', 'Kopien wie die Originale', async () => {
    const PZ = NACHBAR('PROJEKTZENTRALE', 'projektzentrale'), RK = NACHBAR('RESULTKIT', 'resultkit'), BK = NACHBAR('BERICHTKIT', 'berichtkit');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const block = id => { const m = new RegExp(`<script id="${id}">\\n([\\s\\S]*?)</script>`).exec(html); assert.ok(m, id + ' fehlt'); return m[1]; };
    for (const [id, datei] of [['spektron-ordner', 'spektron-ordner.js'], ['archiv-auswertung', 'archiv/auswertung.js'], ['word-luecken', 'word-luecken.js']])
      assert.equal(block(id), fs.readFileSync(path.join(PZ, datei), 'utf8'), `${datei}: nicht byte-gleich mit der Projektzentrale – node tools/einbetten.cjs`);
    for (const [id, datei] of [['lektor-kern', 'src/lektor-kern.js'], ['lektor-app', 'src/lektor-app.js']]) assert.equal(block(id), fs.readFileSync(path.join(ROOT, datei), 'utf8'), `${datei}: index.html nicht neu gebaut – node tools/einbetten.cjs`);
    const { xmlLesenAus } = require('../tools/einbetten.cjs');
    assert.ok(block('lektor-regeln').includes('/* XMLLESEN-KOPIE */\n' + xmlLesenAus(fs.readFileSync(path.join(PZ, 'archiv', 'lesen.js'), 'utf8')) + '\n/* XMLLESEN-KOPIE-ENDE */'), 'xmlLesen nicht wörtlich wie archiv/lesen.js');
    // Regeln aus ResultKit und BerichtKit: gleiche Ergebnisse auf vielen Eingaben
    const vm = require('node:vm'), ctx = { globalThis: {} }; ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(block('archiv-auswertung'), ctx); vm.runInContext(block('lektor-regeln'), ctx); const L = ctx.LektorRegeln;
    const erg = fs.readFileSync(path.join(RK, 'src', 'ergebnisse.ts'), 'utf8');
    const bk = erg.slice(erg.indexOf('export const beschreibungKey='), erg.indexOf(".join(', ');", erg.indexOf('export const beschreibungKey=')) + ".join(', ');".length).replace('export const', 'const').replace(/\(s:unknown\)/g, '(s)').replace(/\n\s*\/\/[^\n]*/g, '');
    const tidyTs = /const tidy=\(s:unknown\)=>([^;]+);/.exec(erg)[1];
    const rk = vm.runInNewContext(`const tidy=(s)=>${tidyTs};${bk};beschreibungKey`);
    const BG = require(path.join(BK, 'bericht-gemeinsam.js'));
    const proben = ['EG Küche , Wand', '„EG“ – Küche', 'OG  WZ REF Wand', 'SZ, KiZ,,HWR', 'Bodenaufbau SZ Unterseite', 'EG Flur Wand, Tiefe: 0–2 mm', '  Lager\tWand ', 'TRHaus', 'GZ-Bad', ''];
    for (const s of proben){ assert.equal(L.beschreibungKey(s), rk(s), 'beschreibungKey: ' + s); assert.equal(JSON.stringify(L.raumAusschreiben(s)), JSON.stringify(BG.raumAusschreiben(s)), 'raumAusschreiben: ' + s); }
    assert.equal(JSON.stringify(L.RAUM_KUERZEL), JSON.stringify(BG.RAUM_KUERZEL));
    const BW = await import(path.join(RK, 'src', 'bewertung.ts'));
    for (const u of ['µg/cm²', 'μg/cm2', 'mg/m²', 'µg/m²', 'mg/cm²', 'µg/100 cm²', 'mg/dm²', 'mg/kg', 'ng/m²', '%']){
      assert.equal(L.chloridEinheit(u), BW.chloridEinheit(u), 'Chlorid-Einheit ' + u);
      const v = BW.vdsScale('Summe 16 EPA-PAK exkl. BG', u, 'residential'); assert.equal(L.pakEinheit(u), v ? v.cats[1].from / 10 : undefined, 'PAK-Einheit ' + u); }
    const ue = fs.readFileSync(path.join(RK, 'src', 'uebersicht.ts'), 'utf8');
    assert.ok(ue.includes(`const SUMME=${L.SUMME.toString()},CHLORID=${L.CHLORID.toString()};`), 'SUMME/CHLORID wie ResultKit uebersicht.ts');
    assert.ok(ue.includes(`export const FLAECHE=${L.FLAECHE.toString()};`), 'FLAECHE wie ResultKit uebersicht.ts');
    const lkTs = fs.readFileSync(path.join(RK, 'src', 'labelkit.ts'), 'utf8');
    assert.ok(lkTs.includes(L.number.toString().replace('function number(p)', 'function number(p:Probe)')), 'Probennummer wie ResultKit labelkit.ts');
  });

  if (was === 'a') return console.log(`${ok} Prüfung grün`);
  await start();
  const archivBasis = () => ({ ...ANDERE });
  const MA = { '_Spektron-Mitarbeiter.json': { format: 'spektron-mitarbeiter', version: 1, personen: [{ ordnerKuerzel: 'Tst', appKuerzel: 'TST', name: 'Dr. Tanja Test', aktiv: true }] } };

  await fall('b', 'echter BerichtKit-Brandbericht, alles passt', async () => {
    await archivAnlegen({ [BR1.ordner]: br1Dateien(), ...archivBasis() }, MA);
    const r = await pruefen(BR1.ordner);
    if (process.env.DUMP) console.log(r.zaehler, '\n' + r.marken.map(m => `${m.status.padEnd(8)} ${m.art.padEnd(12)} ${m.abschnitt.padEnd(9)} „${m.text}“ ${m.probe} ${m.param} ${m.befund || m.notiz}`).join('\n'));
    assert.deepEqual(offen(r), [], 'keine Abweichung erwartet:\n' + zeig(r));
    assert.equal(r.nichtPruefbar.length, 0, 'nichts nicht prüfbar:\n' + zeig(r));
    assert.equal(r.kopf, 'Keine Abweichung gefunden');
    for (const [art, text] of [['wert', '12,3 µg/cm²'], ['wert', '< 0,5 µg/cm²'], ['wert', '2300'], ['wert', '14 mg/kg'], ['wert', '9 µg/m²'], ['wert', '7 µg/m²'], ['raum', 'EG Küche Brandraum Decke'], ['raum', 'Sofa Wohnzimmer, Stoffbezug'],
      ['labnr', '999-2026-0001101'], ['pruefbericht', 'AR-999-2026-000101-01'], ['anlage', 'Anlage 1'], ['anlage', 'Anlage 5'], ['datum', '12.10.2026'], ['datum', '14.10.2026'], ['datum', '05.10.2026'], ['datum', '20.10.2026'], ['schadennr', 'BV-2026-0815'], ['adresse', 'Brandweg 7'], ['probe', 'Probe 9']])
      assert.ok(finde(r, art, text, 'belegt').length, `${art} „${text}“ belegt erwartet:\n` + r.marken.filter(m => m.art === art).map(m => `${m.status} „${m.text}“ ${m.notiz}`).join('\n'));
    assert.ok(r.marken.some(m => m.art === 'wert' && m.text === '12,3 µg/cm²' && m.param === 'Chlorid' && m.probe === 'P1'), 'Wert in Probe 1 zugeordnet');
    assert.deepEqual(finde(r, 'wert', '12,3 µg/cm²').map(m => m.status).sort(), ['belegt', 'ohne'], 'Spanne „zwischen 4,1 und 12,3“ ohne Probe → ohne Beleg, „mit 12,3 in Probe 1“ belegt');
    assert.ok(r.zeilen.some(z => /3 gelesen – 1 mit Projektdaten, 2 nur über den Ordnernamen/.test(z.t)), 'Zählung andere Projekte: ' + r.zeilen.map(z => z.t).join(' | '));
    assert.ok(r.zaehler.belegt >= 40, 'viele belegt: ' + r.zaehler.belegt);
    await page.click('#seite .m.belegt[data-id]'); await schuss('b-alles-passt');
    fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  });

  await fall('c', 'Zahlendreher', async () => {
    const docx = docxErsetzen(BR1_DOCX, [['<w:t xml:space="preserve">2300</w:t>', '<w:t xml:space="preserve">3200</w:t>'], ['mit 12,3 µg/cm² in Probe 1', 'mit 13,2 µg/cm² in Probe 1']]);
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ docx }), ...archivBasis() }, MA);
    const r = await pruefen(BR1.ordner), a = offen(r);
    const t = a.find(m => m.text === '3200'), s = a.find(m => m.text === '13,2 µg/cm²');
    assert.ok(t && t.status === 'abweicht' && /Ziffern vertauscht/.test(t.notiz) && /P4/.test(t.befund) && /2300/.test(t.befund), 'Tabelle 3200 statt 2300:\n' + zeig(r));
    assert.ok(s && s.status === 'abweicht' && /12,3/.test(s.befund) && /P1/.test(s.befund), 'Text 13,2 statt 12,3:\n' + zeig(r));
    assert.equal(a.length, 2, 'genau zwei Befunde:\n' + zeig(r));
    assert.match(r.kopf, /^2 Stellen ansehen/);
  });

  await fall('d', 'falscher Raumname', async () => {
    const x = zipLesen(BR1_DOCX)['word/document.xml'].toString('utf8');
    // zweite Tabelle (PAK), Zeile Probe 5: „EG Flur Wand“ → „EG Bad Wand“
    const i = x.indexOf('Tabelle 2: PAK-Wischproben'), j = x.indexOf('>EG Flur Wand<', i), docx = (() => { const t = zipLesen(BR1_DOCX); t['word/document.xml'] = Buffer.from(x.slice(0, j) + '>EG Bad Wand<' + x.slice(j + '>EG Flur Wand<'.length)); return zipSchreiben(t); })();
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ docx }), ...archivBasis() }, MA);
    const r = await pruefen(BR1.ordner), a = offen(r);
    assert.equal(a.length, 1, zeig(r));
    assert.equal(a[0].art, 'raum'); assert.equal(a[0].text, 'EG Bad Wand'); assert.match(a[0].befund, /P5 heißt in LabelKit „EG Flur Wand“/);
  });

  await fall('e', 'überholte Prüfberichtsfassung', async () => {
    const b = BR1.erg.berichte[0], neu = b.bericht.replace(/-01$/, '-02');
    const extraXml = { ['Laborergebnisse/' + neu + '.xml']: euroXml(neu, { proben: b.proben.map(p => ({ ref: p.ref, labNr: p.labNr, werte: p.werte })) }) };
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ extraXml, erg: false }), ...archivBasis() }, MA);
    const r = await pruefen(BR1.ordner), a = offen(r).filter(m => m.art === 'pruefbericht');
    assert.ok(a.length >= 1 && a.every(m => m.text === b.bericht), zeig(r));
    assert.match(a[0].befund, /-01 ist überholt/); assert.match(a[0].notiz, new RegExp('Fassung ' + neu));
    assert.ok(finde(r, 'wert', '12,3 µg/cm²', 'belegt').length, 'Werte aus -02 belegt');
    await schuss('e-ueberholt');
  });

  await fall('f', 'Straße eines anderen Projekts, Büro und Ort nie', async () => {
    const docx = docxErsetzen(BR1_DOCX, [['Feinreinigung der Wand- und Bodenflächen.', 'Feinreinigung der Wand- und Bodenflächen wie im Objekt Lindenweg 4 in Würselen und Anderort beschrieben, Gouleystr. 59.']]);
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ docx }), ...archivBasis() }, MA);
    const r = await pruefen(BR1.ordner), a = offen(r);
    assert.equal(a.length, 1, zeig(r));
    assert.equal(a[0].status, 'fremd'); assert.equal(a[0].text, 'Lindenweg 4'); assert.match(a[0].befund, /99\.9001 Lindenweg Anderort Tst/);
    assert.ok(!r.marken.some(m => /Würselen|Anderort|Gouleystr/.test(m.text)), 'Ort und Büroadresse nie markiert');
    assert.ok(r.zeilen.some(z => /1 mit Projektdaten, 2 nur über den Ordnernamen/.test(z.t)));
    await page.click(`#seite .m.fremd`); await schuss('f-anderes-projekt');
    // ohne Archiv: deutliche Zeile, kein sauberes Ergebnis
    const o = await pruefen(BR1.ordner, 'Mitteilungen/' + BERICHT, false);
    assert.ok(o.zeilen.some(z => /warn/.test(z.k) && /Andere Projekte nicht geprüft/.test(z.t)));
  });

  await fall('g', 'zwei Proben, ein Wert → ohne Beleg', async () => {
    const docx = docxErsetzen(BR1_DOCX, [['Die Ergebnisse sind in Tabelle 1 zusammengefasst.', 'Probe 2 war n. n. µg/cm². An den Proben 1 und 2 wurden zusammen 16,4 µg/cm² ermittelt. Gemessen wurden 17,4 µg/cm² (Probe 1, Probe 2) und 18,4 µg/cm² in Probe 1 sowie 2. Die Ergebnisse sind in Tabelle 1 zusammengefasst.']]);
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ docx }), ...archivBasis() }, MA);
    const r = await pruefen(BR1.ordner);
    for (const w of ['16,4 µg/cm²', '17,4 µg/cm²', '18,4 µg/cm²']){ const m = finde(r, 'wert', w);
      assert.equal(m.length, 1, w); assert.equal(m[0].status, 'ohne', w + ' ' + m[0].notiz); assert.match(m[0].notiz, /Mehrere Proben/); }
    const nn = finde(r, 'wert', 'n. n. µg/cm²'); assert.equal(nn.length, 1); assert.equal(nn[0].status, 'abweicht', 'n. n. bei P2 (4,1 im Prüfbericht) – im Fließtext erkannt'); assert.equal(nn[0].probe, 'P2');
    assert.deepEqual(offen(r).filter(m => m.text !== 'n. n. µg/cm²'), [], 'ohne Beleg ist kein Problem:\n' + zeig(r));
  });

  await fall('h', 'von Hand geschriebener Bericht, „Ist so gewollt“, gerundet', async () => {
    const hand = docxVonHand(['Kurzbericht Brandschaden Brandweg 7', 'Projekt 99.9002 – Schaden-Nr. BV-2026-0815',
      'Der Ortstermin fand am 14.10.2026 statt. In der Küche (P1) ergab die Chloridmessung 12 µg/cm².',
      'Die PAK-Belastung an P4 (EG Küche Brandraum Decke) beträgt 2300 µg/m². Betroffen sind ca. 85 m² Wand- und Deckenfläche.',
      'Die Referenzprobe P6 (OG Wohnzimmer REF Wand) war mit 9 µg/m² unauffällig.', 'Siehe Prüfbericht AR-999-2026-000101-01.']);
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ docx: BR1_DOCX }), ...archivBasis() }, MA);
    await page.evaluate(() => { localStorage.removeItem('lektorkit-kuerzel'); localStorage.removeItem('spektron-ich'); });
    await page.evaluate(async () => { const root = await navigator.storage.getDirectory(), archiv = await root.getDirectoryHandle('Archiv'); await LektorKitTest.oeffnen(await archiv.getDirectoryHandle('99.9002 Brandweg Beispielstadt Tst'), archiv); await LektorKitTest.warteAndere(); });
    const datei = path.join(OUT, 'hand.docx'); fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(datei, hand);
    await page.setInputFiles('#eingabeDatei', datei);
    await page.waitForFunction(() => LektorKitTest.zustand().erg && LektorKitTest.zustand().bericht.quelle === 'abgelegt');
    const r = await page.evaluate(() => LektorKitTest.zustand().erg.marken.map(m => ({ id: m.id, art: m.art, status: m.status, text: m.text, befund: m.befund || '', notiz: m.notiz || '' })));
    const f = x => r.filter(m => m.text === x);
    assert.equal(f('12 µg/cm²')[0].status, 'abweicht'); assert.match(f('12 µg/cm²')[0].notiz, /gerundet\? Prüfbericht: 12,3/);
    assert.equal(f('2300 µg/m²')[0].status, 'belegt'); assert.equal(f('9 µg/m²')[0].status, 'belegt'); assert.equal(f('EG Küche Brandraum Decke')[0].status, 'belegt');
    assert.equal(f('85 m²')[0].status, 'ohne'); assert.equal(f('14.10.2026')[0].status, 'belegt'); assert.equal(f('AR-999-2026-000101-01')[0].status, 'belegt');
    assert.equal(f('BV-2026-0815')[0].status, 'belegt'); assert.equal(f('99.9002')[0].status, 'belegt'); assert.equal(f('P1')[0].status, 'belegt');
    assert.equal(r.filter(m => m.status === 'abweicht' || m.status === 'fremd').length, 1, r.filter(m => m.status !== 'belegt').map(m => m.status + ' ' + m.text + ' ' + m.notiz).join('\n'));
    // „Ist so gewollt“: Kürzel wählen, vermerken
    await page.click(`#befunde [data-gewollt]`);
    await page.waitForSelector('#dlgKuerzel[open]'); await page.selectOption('#selKuerzel', 'Tst'); await page.click('#dlgKuerzel button[value=ok]');
    await page.waitForFunction(() => LektorKitTest.zustand().erg.zaehler.gewollt === 1, null, { timeout: 5000 }).catch(async e => { console.log(await page.textContent('#uebersicht'), await page.textContent('#meldung')); throw e; });
    const datei2 = await page.evaluate(async () => { const r = await navigator.storage.getDirectory(); const d = await (await (await (await (await r.getDirectoryHandle('Archiv')).getDirectoryHandle('99.9002 Brandweg Beispielstadt Tst')).getDirectoryHandle('_Spektron')).getDirectoryHandle('LektorKit')).getFileHandle('_LektorKit.json'); return JSON.parse(await (await d.getFile()).text()); });
    assert.equal(await page.evaluate(() => LektorKitTest.heute(new Date(2026, 10, 14, 0, 30))), '2026-11-14', 'Ortstag, nicht UTC');
    assert.equal(datei2.gewollt[0].am, await page.evaluate(() => LektorKitTest.heute()));
    assert.equal(datei2.format, 'spektron-lektorkit'); assert.equal(datei2.gewollt.length, 1); assert.equal(datei2.gewollt[0].kuerzel, 'Tst'); assert.match(datei2.gewollt[0].am, /^\d{4}-\d{2}-\d{2}$/); assert.equal(datei2.gewollt[0].datei, 'hand.docx');
    assert.equal(await page.textContent('#kopfzeile'), 'Keine offene Abweichung (1 als gewollt bestätigt)');
    await schuss('h-von-hand-gewollt');
    // erneut einlesen: bleibt gewollt
    await page.setInputFiles('#eingabeDatei', datei); await page.waitForFunction(() => LektorKitTest.zustand().erg.zaehler.gewollt === 1);
  });

  await fall('i', 'Bericht und Projektdateien byte-gleich; altes Projekt ohne „_Spektron“', async () => {
    const ALT = '25.0100 Altweg 3 Altstadt Tst';
    const altDateien = { '_Projekt.json': { ...BR1.pj, projektnummer: '25.0100', objekt: 'Altweg 3, 22222 Altstadt' }, 'Laboraufträge/25.0100_Daten.json': BR1.lk,
      'Mitteilungen/1._Mitteilung_25.0100.docx': docxVonHand(['Die Chloridbelastung an P1 beträgt 99 µg/cm².']),
      'Laborergebnisse/AR-999-2025-000900-01.xml': euroXml('AR-999-2025-000900-01', { ref: '25.0100 Altstadt', proben: [{ ref: 'Probe 1', labNr: '999-2025-0009001', werte: [{ p: 'Chlorid', r: '12,3', u: 'µg/cm²' }] }] }) };
    await archivAnlegen({ [BR1.ordner]: br1Dateien(), [ALT]: altDateien, ...archivBasis() }, MA);
    const vorher = await ablage();
    const r = await pruefen(BR1.ordner);
    for (const sel of ['#seite .m.belegt', '#seite .m.ohne', '#befunde button[data-zeigen]']) if (await page.$(sel)) await page.click(sel);
    await page.click('#btnNeu'); await page.waitForTimeout(300); await page.evaluate(() => LektorKitTest.warteAndere());
    await page.evaluate(() => { document.getElementById('btnDrucken').onclick = null; });
    assert.ok(r.zaehler.belegt > 0);
    const nachher = await ablage();
    assert.deepEqual(nachher, vorher, 'nach dem Lauf: jede Datei byte-gleich, keine neue Datei');
    // altes Projekt: „Ist so gewollt“ schreibt nach Mitteilungen, nie „_Spektron“
    await page.evaluate(() => localStorage.setItem('lektorkit-kuerzel', 'Tst'));
    const r2 = await pruefen(ALT, 'Mitteilungen/1._Mitteilung_25.0100.docx');
    assert.equal(offen(r2).length, 1, zeig(r2)); await page.click('#befunde [data-gewollt]');
    await page.waitForFunction(() => LektorKitTest.zustand().erg.zaehler.gewollt === 1);
    const n2 = await ablage(), neu = Object.keys(n2).filter(k => !(k in vorher)), geaendert = Object.keys(vorher).filter(k => n2[k] !== vorher[k]);
    assert.deepEqual(neu, ['Archiv/' + ALT + '/Mitteilungen/_LektorKit.json'], 'nur die eigene Datei neu');
    assert.deepEqual(geaendert, [], 'keine fremde Datei geändert');
    assert.ok(!Object.keys(n2).some(k => k.startsWith('Archiv/' + ALT + '/_Spektron')), 'kein _Spektron im alten Projekt');
  });

  await fall('j', 'nicht prüfbar: nur PDF, Übernahme nicht aktuell', async () => {
    // Prüfbericht 101 nur als PDF; _Ergebnisse.json hat ihn (aus der PDF übernommen), aber der Ordner hat sich seitdem geändert
    const d = br1Dateien({ xml: false });
    d['Laborergebnisse/' + BR1.erg.berichte[1].bericht + '.xml'] = euroXml(BR1.erg.berichte[1].bericht, { proben: BR1.erg.berichte[1].proben.map(p => ({ ref: p.ref, labNr: p.labNr, werte: p.werte })) });
    d['_Spektron/ResultKit/_Ergebnisse.json'] = { ...d['_Spektron/ResultKit/_Ergebnisse.json'], stand: 'alter Stand' };
    await archivAnlegen({ [BR1.ordner]: d, ...archivBasis() }, MA);
    const r = await pruefen(BR1.ordner);
    const w = r.zeilen.find(z => /warn/.test(z.k) && /nicht prüfbar/.test(z.t));
    assert.ok(w, 'Warnzeile oben: ' + r.zeilen.map(z => z.t).join(' | '));
    assert.match(w.t, /Prüfbericht nur als PDF, ResultKit-Übernahme nicht aktuell/);
    const n = r.nichtPruefbar.reduce((s, x) => s + x.n, 0); assert.ok(n >= 8, 'Zahl: ' + n); assert.match(w.t, new RegExp('^⚠ ' + n + ' Angaben'));
    assert.notEqual(r.kopf, 'Keine Abweichung gefunden'); assert.match(r.kopf, /nicht prüfbar/);
    assert.equal(r.zaehler.belegt > 0, true);
    await schuss('j-nicht-pruefbar');
  });

  await fall('l', 'Codex PR #1: fehlender Bericht im Link, alte Übernahme mit gelöschter -02', async () => {
    // alte Übernahme (Stand passt nicht) nennt -02 und führt -01 als ersetzt – im Ordner liegt aber nur noch -01
    const b = BR1.erg.berichte[0], neu = b.bericht.replace(/-01$/, '-02'), d = br1Dateien();
    d['_Spektron/ResultKit/_Ergebnisse.json'] = { ...d['_Spektron/ResultKit/_Ergebnisse.json'], stand: 'alter Stand',
      berichte: [{ ...b, bericht: neu, sources: { xml: neu + '.xml', pdf: neu + '.pdf' } }, BR1.erg.berichte[1]], ersetzt: [{ bericht: b.bericht, durch: [neu] }] };
    await archivAnlegen({ [BR1.ordner]: d, ...archivBasis() }, MA);
    const r = await pruefen(BR1.ordner);
    assert.ok(finde(r, 'pruefbericht', b.bericht).every(m => m.status === 'belegt'), '-01 liegt da und gilt:\n' + zeig(r));
    // Link mit einem Bericht, den es nicht gibt: nichts lesen, Auswahl offen, Meldung
    const s = await page.evaluate(async () => { const root = await navigator.storage.getDirectory(), archiv = await root.getDirectoryHandle('Archiv');
      await LektorKitTest.oeffnen(await archiv.getDirectoryHandle('99.9002 Brandweg Beispielstadt Tst'), archiv, 'Mitteilungen/2._Mitteilung_99.9002_Entwurf.docx');
      return { doc: !!LektorKitTest.zustand().doc, start: !document.getElementById('start').classList.contains('versteckt'), meldung: document.getElementById('meldung').textContent }; });
    assert.equal(s.doc, false); assert.equal(s.start, true); assert.match(s.meldung, /2\._Mitteilung_99\.9002_Entwurf\.docx“ liegt nicht in „Mitteilungen“/);
    await page.evaluate(() => LektorKitTest.warteAndere());
    // „Bericht neu einlesen“, nachdem der Bericht umbenannt wurde: nichts anderes lesen
    await pruefen(BR1.ordner);
    const n = await page.evaluate(async b => { const root = await navigator.storage.getDirectory(), m = await (await (await root.getDirectoryHandle('Archiv')).getDirectoryHandle('99.9002 Brandweg Beispielstadt Tst')).getDirectoryHandle('Mitteilungen');
      await m.removeEntry(b); document.getElementById('btnNeu').click(); for (let i = 0; i < 100 && !document.getElementById('meldung').textContent; i++) await new Promise(r => setTimeout(r, 30));
      return { doc: !!LektorKitTest.zustand().doc, meldung: document.getElementById('meldung').textContent }; }, BERICHT);
    assert.equal(n.doc, false); assert.match(n.meldung, /liegt nicht in „Mitteilungen“/);
    await page.evaluate(() => LektorKitTest.warteAndere());
    // zwei Projekte kurz nacheinander öffnen: es gilt das zuletzt geöffnete, auch wenn das erste langsamer fertig wird
    await archivAnlegen({ [BR1.ordner]: br1Dateien(), '25.0100 Altweg 3 Altstadt Tst': { '_Projekt.json': { projektnummer: '25.0100', objekt: 'Altweg 3' } }, ...archivBasis() }, MA);
    const w = await page.evaluate(async () => { const root = await navigator.storage.getDirectory(), archiv = await root.getDirectoryHandle('Archiv');
      const a = LektorKitTest.oeffnen(await archiv.getDirectoryHandle('99.9002 Brandweg Beispielstadt Tst'), archiv), b = LektorKitTest.oeffnen(await archiv.getDirectoryHandle('25.0100 Altweg 3 Altstadt Tst'), archiv);
      await Promise.all([a, b]); await LektorKitTest.warteAndere(); const S = LektorKitTest.zustand(); return [S.dir.name, S.daten.projekt.name, S.andere ? S.andere.nr.has('99.9002') : null]; });
    assert.deepEqual(w, ['25.0100 Altweg 3 Altstadt Tst', '25.0100 Altweg 3 Altstadt Tst', true]);
    // dieselbe Tabelle in zwei Kopfzeilen: Zellen nur einmal ausgewertet
    const kopf = '<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Schaden-Nr.: XY-2025-12345</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:hdr>';
    const z = zipLesen(docxVonHand(['Text'])); z['word/header1.xml'] = Buffer.from(kopf); z['word/header2.xml'] = Buffer.from(kopf);
    const segs = await page.evaluate(async b => { const d = await LektorKern.docxLesen(Uint8Array.from(atob(b), c => c.charCodeAt(0))); return d.segs.filter(s => !s.leer && /XY-2025/.test(s.text)).length; }, zipSchreiben(z).toString('base64'));
    assert.equal(segs, 1, 'doppelte Kopftabelle nur einmal');
    // Kopfzeile, die kein Abschnitt benutzt (liegengebliebene header2.xml): nicht gelesen
    const z2 = zipLesen(docxVonHand(['Text'])), W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    z2['word/document.xml'] = Buffer.from(`<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>Text</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr></w:body></w:document>`);
    z2['word/_rels/document.xml.rels'] = Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>');
    z2['word/header1.xml'] = Buffer.from(kopf.replace('XY-2025-12345', 'AB-2025-11111')); z2['word/header2.xml'] = Buffer.from(kopf.replace('XY-2025-12345', 'ZZ-2025-99999'));
    const kt = await page.evaluate(async b => (await LektorKern.docxLesen(Uint8Array.from(atob(b), c => c.charCodeAt(0)))).segs.filter(s => !s.leer).map(s => s.text).join(' | '), zipSchreiben(z2).toString('base64'));
    assert.match(kt, /AB-2025-11111/); assert.doesNotMatch(kt, /ZZ-2025-99999/);
    // Präfixe frei gewählt (x:/rel: statt w:/r:): Kopfzeile trotzdem gefunden
    const z3 = zipLesen(zipSchreiben(z2));
    z3['word/document.xml'] = Buffer.from(z3['word/document.xml'].toString().replace(/w:/g, 'x:').replace(/xmlns:w=/g, 'xmlns:x=').replace(/r:id=/g, 'rel:id=').replace(/xmlns:r=/g, 'xmlns:rel='));
    const kt3 = await page.evaluate(async b => (await LektorKern.docxLesen(Uint8Array.from(atob(b), c => c.charCodeAt(0)))).segs.filter(s => !s.leer).map(s => s.text).join(' | '), zipSchreiben(z3).toString('base64'));
    assert.match(kt3, /AB-2025-11111/); assert.doesNotMatch(kt3, /ZZ-2025-99999/);
    // Strict Open XML (andere Namensraum-URIs): Kopfzeile trotzdem gefunden
    const z4 = zipLesen(zipSchreiben(z2));
    z4['word/document.xml'] = Buffer.from(z4['word/document.xml'].toString().replace('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main').replace('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'));
    const kt4 = await page.evaluate(async b => (await LektorKern.docxLesen(Uint8Array.from(atob(b), c => c.charCodeAt(0)))).segs.filter(s => !s.leer).map(s => s.text).join(' | '), zipSchreiben(z4).toString('base64'));
    assert.match(kt4, /AB-2025-11111/); assert.doesNotMatch(kt4, /ZZ-2025-99999/);
    // Fußzeile mit der Projektnummer eines anderen Projekts: gelesen und als „anderes Projekt“ gemeldet; unbenutzte Fußzeile nicht
    const z5 = zipLesen(zipSchreiben(z2)), fussXml = n => `<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Projekt ${n}</w:t></w:r></w:p></w:ftr>`;
    z5['word/document.xml'] = Buffer.from(z5['word/document.xml'].toString().replace('</w:sectPr>', '<w:footerReference w:type="default" r:id="rId8"/></w:sectPr>'));
    z5['word/_rels/document.xml.rels'] = Buffer.from(z5['word/_rels/document.xml.rels'].toString().replace('</Relationships>', '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'));
    z5['word/footer1.xml'] = Buffer.from(fussXml('99.9001')); z5['word/footer2.xml'] = Buffer.from(fussXml('99.8000'));
    const fz = await page.evaluate(async b => { const doc = await LektorKern.docxLesen(Uint8Array.from(atob(b), c => c.charCodeAt(0)));
      const r = LektorKern.analysieren(doc, { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, messungen: [], berichte: [], andere: LektorKern.andereIndex([{ name: '99.9001 Lindenweg Anderort Tst', nr: '99.9001', pj: null }, { name: '99.8000 Altbau Tst', nr: '99.8000', pj: null }], '99.9002') });
      return r.marken.filter(m => m.art === 'projektnr').map(m => m.text + ':' + m.status + ':' + m.abschnitt); }, zipSchreiben(z5).toString('base64'));
    assert.deepEqual(fz, ['99.9001:fremd:Fußzeile']);
    // „first“-Kopfzeile ohne titlePg und „even“ ohne evenAndOddHeaders: nicht sichtbar, nicht gelesen; mit titlePg schon
    const z6 = zipLesen(zipSchreiben(z2));
    z6['word/document.xml'] = Buffer.from(z6['word/document.xml'].toString().replace('</w:sectPr>', '<w:headerReference w:type="first" r:id="rId9"/><w:headerReference w:type="even" r:id="rId10"/></w:sectPr>'));
    z6['word/_rels/document.xml.rels'] = Buffer.from(z6['word/_rels/document.xml.rels'].toString().replace('</Relationships>', '<Relationship Id="rId9" Type="x" Target="header3.xml"/><Relationship Id="rId10" Type="x" Target="header4.xml"/></Relationships>'));
    z6['word/header3.xml'] = Buffer.from(kopf.replace('XY-2025-12345', 'ER-2025-33333')); z6['word/header4.xml'] = Buffer.from(kopf.replace('XY-2025-12345', 'GE-2025-44444'));
    const lies = z => page.evaluate(async b => (await LektorKern.docxLesen(Uint8Array.from(atob(b), c => c.charCodeAt(0)))).segs.filter(s => !s.leer).map(s => s.text).join(' | '), zipSchreiben(z).toString('base64'));
    const k6 = await lies(z6); assert.match(k6, /AB-2025-11111/); assert.doesNotMatch(k6, /ER-2025-33333|GE-2025-44444/);
    z6['word/document.xml'] = Buffer.from(z6['word/document.xml'].toString().replace('</w:sectPr>', '<w:titlePg/></w:sectPr>'));
    assert.match(await lies(z6), /ER-2025-33333/);
    // zwei Abschnitte: der erste hat die „first“-Kopfzeile ohne titlePg, der zweite titlePg ohne eigene „first“ → geerbt, also sichtbar
    const z9 = zipLesen(zipSchreiben(z6)), W9 = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    z9['word/document.xml'] = Buffer.from(`<?xml version="1.0"?><w:document ${W9}><w:body><w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId7"/><w:headerReference w:type="first" r:id="rId9"/></w:sectPr></w:pPr><w:r><w:t>Teil 1</w:t></w:r></w:p><w:p><w:r><w:t>Teil 2</w:t></w:r></w:p><w:sectPr><w:titlePg/></w:sectPr></w:body></w:document>`);
    const k9 = await lies(z9); assert.match(k9, /ER-2025-33333/); assert.match(k9, /AB-2025-11111/); assert.doesNotMatch(k9, /GE-2025-44444/);
    // „P1“ innerhalb einer Prüfberichtsnummer ist keine Probe – die Nummer wird geprüft
    const k10 = await page.evaluate(() => LektorKern.analysieren({ bloecke: [], segs: [{ id: 0, text: 'Siehe Prüfbericht AB-P1-123-01.', art: 'p', teil: 'document', abschnitt: '4', titel: 'Probenahme' }] },
      { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, berichte: [{ code: 'AB-P1-123-02', grund: 'AB-P1-123', fassung: 2, fremd: '' }], messungen: [] }).marken.map(m => m.art + ':' + m.text + ':' + m.status));
    assert.deepEqual(k10, ['pruefbericht:AB-P1-123-01:abweicht']);
    // Fußnote mit Verweis wird gelesen, Trennlinie und verwaiste Note nicht
    const z7 = zipLesen(docxVonHand(['Text']));
    z7['word/document.xml'] = Buffer.from(z7['word/document.xml'].toString().replace('<w:t xml:space="preserve">Text</w:t></w:r>', '<w:t xml:space="preserve">Text</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>'));
    z7['word/footnotes.xml'] = Buffer.from('<?xml version="1.0"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:t>TR-2025-00000</w:t></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Siehe Projekt 99.9001</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>verwaist VW-2025-55555</w:t></w:r></w:p></w:footnote></w:footnotes>');
    const k7 = await lies(z7); assert.match(k7, /Siehe Projekt 99\.9001/); assert.doesNotMatch(k7, /TR-2025|VW-2025/);
    // Verweis auf Fußnote 2 nur noch in gelöschtem Text, frühere Abschnittsangaben (sectPrChange) mit anderer Kopfzeile: beides nicht gelesen
    z7['word/document.xml'] = Buffer.from(z7['word/document.xml'].toString().replace('<w:footnoteReference w:id="1"/></w:r>', '<w:footnoteReference w:id="1"/></w:r><w:del w:id="5" w:author="x"><w:r><w:footnoteReference w:id="2"/></w:r></w:del>'));
    assert.doesNotMatch(await lies(z7), /VW-2025/);
    const z11 = zipLesen(zipSchreiben(z2));
    z11['word/document.xml'] = Buffer.from(z11['word/document.xml'].toString().replace('</w:sectPr>', '<w:sectPrChange w:id="6" w:author="x"><w:sectPr><w:headerReference w:type="default" r:id="rId9"/></w:sectPr></w:sectPrChange></w:sectPr>'));
    z11['word/_rels/document.xml.rels'] = Buffer.from(z11['word/_rels/document.xml.rels'].toString().replace('</Relationships>', '<Relationship Id="rId9" Type="x" Target="header3.xml"/></Relationships>'));
    z11['word/header3.xml'] = Buffer.from(kopf.replace('XY-2025-12345', 'HI-2025-66666'));
    const k11 = await lies(z11); assert.match(k11, /AB-2025-11111/); assert.doesNotMatch(k11, /HI-2025-66666/);
    // gelöschte Tabellenzeile zählt nicht
    const z12 = zipLesen(docxVonHand(['x']));
    z12['word/document.xml'] = Buffer.from(z12['word/document.xml'].toString().replace('<w:body>', '<w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>sichtbar</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:trPr><w:del w:id="9" w:author="x"/></w:trPr><w:tc><w:p><w:r><w:t>DZ-2025-77777</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'));
    const k12 = await lies(z12); assert.match(k12, /sichtbar/); assert.doesNotMatch(k12, /DZ-2025/);
    // verschachtelte Tabelle in einer Zelle wird gelesen
    z12['word/document.xml'] = Buffer.from(z12['word/document.xml'].toString().replace('<w:t>sichtbar</w:t></w:r></w:p>', '<w:t>sichtbar</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>innen NE-2025-88888</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'));
    assert.match(await lies(z12), /innen NE-2025-88888/);
    // zwei Wertspalten in einer Tabelle: beide geprüft; eine weitere Spalte prüft der allgemeine Durchlauf
    const k14 = await page.evaluate(() => { const s = (id, text) => ({ id, text, art: 'zelle', teil: 'document', abschnitt: '5', titel: 'Befund' });
      const segs = [s(0, 'Probe'), s(1, 'Chlorid [µg/cm²]'), s(2, 'Σ 16 EPA-PAK [µg/m²]'), s(3, 'Bemerkung'), s(4, '1'), s(5, '12,3'), s(6, '999'), s(7, 'Projekt 99.9001')];
      const d = { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, berichte: [], messungen: [{ label: 'P1', p: 'Chlorid', u: 'µg/cm²', roh: '12,3', q: 'gemessen', v: 12.3, bericht: 'AR-1' }, { label: 'P1', p: 'Summe 16 EPA-PAK', u: 'µg/m²', roh: '230', q: 'gemessen', v: 230, bericht: 'AR-1' }],
        andere: LektorKern.andereIndex([{ name: '99.9001 Anderort Tst', nr: '99.9001', pj: null }], '99.9002') };
      return LektorKern.analysieren({ bloecke: [{ typ: 'tab', zeilen: [segs.slice(0, 4), segs.slice(4)] }], segs }, d).marken.filter(m => m.art !== 'probe').map(m => m.art + ':' + m.text + ':' + m.status); });
    assert.deepEqual(k14, ['wert:12,3:belegt', 'wert:999:abweicht', 'projektnr:99.9001:fremd']);
    // Probe-Spalte „P1“ / „Probe 1“; ausgeblendeter Text nicht, Textfeld schon (Ersatzdarstellung nur einmal)
    const k16 = await page.evaluate(() => { const s = (id, text) => ({ id, text, art: 'zelle', teil: 'document', abschnitt: '5', titel: 'Befund' });
      const segs = [s(0, 'Probe'), s(1, 'Chlorid [µg/cm²]'), s(2, 'Probe 1'), s(3, '13,2'), s(4, 'P1'), s(5, '12,3')];
      const d = { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, berichte: [], messungen: [{ label: 'P1', p: 'Chlorid', u: 'µg/cm²', roh: '12,3', q: 'gemessen', v: 12.3, bericht: 'AR-1' }] };
      return LektorKern.analysieren({ bloecke: [{ typ: 'tab', zeilen: [segs.slice(0, 2), segs.slice(2, 4), segs.slice(4)] }], segs }, d).marken.filter(m => m.art === 'wert').map(m => m.text + ':' + m.status); });
    assert.deepEqual(k16, ['13,2:abweicht', '12,3:belegt']);
    const z13 = zipLesen(docxVonHand(['x'])), WV = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
    z13['word/document.xml'] = Buffer.from(`<?xml version="1.0"?><w:document ${WV}><w:body><w:p><w:r><w:t>sichtbar </w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>VS-2025-12121</w:t></w:r>` +
      `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>Feld TB-2025-34343</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>Feld TB-2025-34343</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p></w:body></w:document>`);
    const k17 = await lies(z13); assert.doesNotMatch(k17, /VS-2025/); assert.equal((k17.match(/TB-2025-34343/g) || []).length, 1, k17);
    // „in Probe 1, in Probe 2 ebenfalls“ → ohne Beleg; Auftraggeber eines anderen Projekts ohne Adresse erkannt
    const k13 = await page.evaluate(() => { const seg = t => ({ bloecke: [], segs: [{ id: 0, text: t, art: 'p', teil: 'document', abschnitt: '5.2', titel: 'Korrosionsschäden' }] });
      const d = { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, berichte: [], messungen: [{ label: 'P1', p: 'Chlorid', u: 'µg/cm²', roh: '12', q: 'gemessen', v: 12, bericht: 'AR-1' }, { label: 'P2', p: 'Chlorid', u: 'µg/cm²', roh: '3', q: 'gemessen', v: 3, bericht: 'AR-1' }],
        andere: LektorKern.andereIndex([{ name: '99.9001 Anderort Tst', nr: '99.9001', pj: { auftraggeber: 'Fremd Versicherung AG, Lindenweg 4, 12345 Ort' } }], '99.9002') };
      return [LektorKern.analysieren(seg('Gemessen wurden 12 µg/cm² in Probe 1, in Probe 2 ebenfalls.'), d).marken.find(m => m.art === 'wert').status,
        LektorKern.analysieren(seg('Auftraggeber ist die Fremd Versicherung AG.'), d).marken.map(m => m.art + ':' + m.status)]; });
    assert.deepEqual(k13, ['ohne', ['name:fremd']]);
    const k15 = await page.evaluate(() => { const d = { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, berichte: [], messungen: [{ label: 'P1', p: 'Chlorid', u: 'µg/cm²', roh: '12', q: 'gemessen', v: 12, bericht: 'AR-1' }, { label: 'P2', p: 'Chlorid', u: 'µg/cm²', roh: '3', q: 'gemessen', v: 3, bericht: 'AR-1' }] };
      return ['Gemessen wurden 12 µg/cm² in Probe 1, 13 µg/cm² in Probe 2.', 'Gemessen wurden 12 µg/cm² in Probe 1 und 3 µg/cm² in Probe 2.'].map(x => LektorKern.analysieren({ bloecke: [], segs: [{ id: 0, text: x, art: 'p', teil: 'document', abschnitt: '5.2', titel: 'Korrosionsschäden' }] }, d).marken.filter(m => m.art === 'wert').map(m => m.probe + ':' + m.status).join(' ')); });
    assert.deepEqual(k15, ['P1:belegt P2:abweicht', 'P1:belegt P2:belegt']);
    // zwei „Ist so gewollt“ kurz nacheinander: beide bleiben in der Datei
    const docx2 = docxErsetzen(BR1_DOCX, [['<w:t xml:space="preserve">2300</w:t>', '<w:t xml:space="preserve">3200</w:t>'], ['mit 12,3 µg/cm² in Probe 1', 'mit 13,2 µg/cm² in Probe 1']]);
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ docx: docx2 }), '25.0100 Altweg 3 Altstadt Tst': { '_Projekt.json': { projektnummer: '25.0100', objekt: 'Altweg 3' } }, ...archivBasis() }, MA);
    await page.evaluate(() => localStorage.setItem('lektorkit-kuerzel', 'Tst'));
    await pruefen(BR1.ordner);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#befunde [data-gewollt]')]; b[0].click(); b[1].click(); });
    await page.waitForFunction(() => LektorKitTest.zustand().erg.zaehler.gewollt === 2, null, { timeout: 5000 });
    const g2 = await page.evaluate(async () => { const r = await navigator.storage.getDirectory(); const d = await (await (await (await (await r.getDirectoryHandle('Archiv')).getDirectoryHandle('99.9002 Brandweg Beispielstadt Tst')).getDirectoryHandle('_Spektron')).getDirectoryHandle('LektorKit')).getFileHandle('_LektorKit.json'); return JSON.parse(await (await d.getFile()).text()).gewollt.length; });
    assert.equal(g2, 2, 'beide Bestätigungen in der Datei');
    // „Ist so gewollt“ in Projekt A, sofort Projekt B öffnen: Vermerk landet in A, B bleibt unberührt
    await pruefen(BR1.ordner);
    const ab = await page.evaluate(async () => { const root = await navigator.storage.getDirectory(), archiv = await root.getDirectoryHandle('Archiv');
      document.querySelector('#befunde [data-zurueck]').click(); await LektorKitTest.oeffnen(await archiv.getDirectoryHandle('25.0100 Altweg 3 Altstadt Tst'), archiv);
      for (let i = 0; i < 50; i++) await new Promise(r => setTimeout(r, 20));
      const a = JSON.parse(await (await (await (await (await (await archiv.getDirectoryHandle('99.9002 Brandweg Beispielstadt Tst')).getDirectoryHandle('_Spektron')).getDirectoryHandle('LektorKit')).getFileHandle('_LektorKit.json')).getFile()).text()).gewollt.length;
      let b = 'keine'; try{ await (await (await archiv.getDirectoryHandle('25.0100 Altweg 3 Altstadt Tst')).getDirectoryHandle('Mitteilungen')).getFileHandle('_LektorKit.json'); b = 'da'; }catch(e){}
      return [a, b, LektorKitTest.zustand().gewollt.length, LektorKitTest.zustand().daten.projekt.name]; });
    assert.deepEqual(ab, [1, 'keine', 0, '25.0100 Altweg 3 Altstadt Tst']);
    await page.evaluate(() => LektorKitTest.warteAndere());
    // doppelt vergebene Probennummer in LabelKit: nicht prüfbar, nie „belegt“
    const lk2 = JSON.parse(JSON.stringify(BR1.lk)); lk2.proben.push({ ...lk2.proben[0], z2: 'Kopie' });
    const d2 = br1Dateien(); d2['_Spektron/LabelKit/99.9002_Daten.json'] = lk2;
    await archivAnlegen({ [BR1.ordner]: d2, '25.0100 Altweg 3 Altstadt Tst': { '_Projekt.json': { projektnummer: '25.0100', objekt: 'Altweg 3' } }, ...archivBasis() }, MA);
    const r4 = await pruefen(BR1.ordner), p4 = r4.marken.filter(m => m.art === 'probe' && m.probe === 'P4');
    assert.ok(p4.length && p4.every(m => m.status === 'ohne' && /doppelt/.test(m.np)), JSON.stringify(p4));
    assert.ok(r4.zeilen.some(z => /warn/.test(z.k) && /Probennummer in LabelKit doppelt vergeben/.test(z.t)));
    // Prüfbericht nur als PDF-Dateiname: ganze Nummer, keine längere
    const k5 = await page.evaluate(() => { const doc = { bloecke: [], segs: [{ id: 0, text: 'Siehe Prüfbericht ABC-1-2-30 und XYZ-1-2-31.', art: 'p', teil: 'document', abschnitt: '4', titel: 'Probenahme' }] };
      return LektorKern.analysieren(doc, { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, berichte: [], pdfNamen: ['ABC-1-2-300.pdf', 'Bericht XYZ-1-2-31.pdf'], messungen: [] }).marken.map(m => m.text + ':' + m.status); });
    assert.deepEqual(k5, ['ABC-1-2-30:ohne', 'XYZ-1-2-31:belegt']);
    // neuere Fassung nur als PDF: die zitierte ist überholt; gleiches Datum in zwei Rollen: zwei Schlüssel
    const k18 = await page.evaluate(() => { const seg = t => ({ bloecke: [], segs: [{ id: 0, text: t, art: 'p', teil: 'document', abschnitt: '1', titel: 'Veranlassung' }] });
      const d = { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, berichte: [], messungen: [], pdfNamen: ['ABC-1-2-01.pdf', 'ABC-1-2-02.pdf'], pj: { schadendatum: '2026-01-01', auftragsdatum: '2026-01-01' } };
      const a = LektorKern.analysieren(seg('Siehe Prüfbericht ABC-1-2-01.'), d).marken.map(m => m.status + ':' + m.befund);
      const k = LektorKern.analysieren(seg('Am 01.01.2026 kam es zu einem Brand. Am 01.01.2026 wurde unser Büro beauftragt.'), d).marken.filter(m => m.art === 'datum').map(m => m.schluessel);
      return [a, new Set(k).size]; });
    assert.deepEqual(k18, [['abweicht:Prüfbericht -01 ist überholt'], 2]);
    // -02 eines anderen Projekts macht die eigene -01 nicht „überholt“; „gewollt“ gilt nur für denselben Befund
    const k8 = await page.evaluate(() => { const seg = t => ({ bloecke: [], segs: [{ id: 0, text: t, art: 'p', teil: 'document', abschnitt: '5.2', titel: 'Korrosionsschäden' }] });
      const basis = { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, berichte: [{ code: 'AR-1-2-01', grund: 'AR-1-2', fassung: 1, fremd: '' }, { code: 'AR-1-2-02', grund: 'AR-1-2', fassung: 2, fremd: '99.9001', ref: '99.9001 Anderort' }] };
      const a = LektorKern.analysieren(seg('Siehe Prüfbericht AR-1-2-01.'), { ...basis, messungen: [] }).marken.map(m => m.status);
      const w = v => ({ ...basis, messungen: [{ label: 'P1', p: 'Chlorid', u: 'µg/cm²', roh: v, q: 'gemessen', v: Number(v.replace(',', '.')), bericht: 'AR-1-2-01' }] });
      const r1 = LektorKern.analysieren(seg('In Probe 1 wurden 12 µg/cm² gemessen.'), w('12,3')), m1 = r1.marken.find(m => m.art === 'wert');
      const g = [{ schluessel: m1.schluessel, befund: m1.befund, kuerzel: 'Tst', am: '2026-11-13' }];
      return [a, !!LektorKern.analysieren(seg('In Probe 1 wurden 12 µg/cm² gemessen.'), { ...w('12,3'), gewollt: g }).marken.find(m => m.art === 'wert').gewollt,
        !!LektorKern.analysieren(seg('In Probe 1 wurden 12 µg/cm² gemessen.'), { ...w('15,0'), gewollt: g }).marken.find(m => m.art === 'wert').gewollt]; });
    assert.deepEqual(k8, [['belegt'], true, false]);
    // Spannen sind keine Messwerte; verschobener Alttext (moveFrom) zählt nicht
    const sp = await page.evaluate(() => { const seg = t => ({ id: 0, text: t, art: 'p', teil: 'document', abschnitt: '5.2', titel: 'Korrosionsschäden' });
      const d = { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, messungen: [{ label: 'P1', p: 'Chlorid', u: 'µg/cm²', roh: '12,3', q: 'gemessen', v: 12.3, bericht: 'AR-1' }], berichte: [] };
      return ['Die Werte liegen zwischen 4,1 und 12,3 µg/cm² in Probe 1.', 'In Probe 1 wurden 4,1–12,3 µg/cm² gemessen.', 'In Probe 1 wurden 4,1 µg/cm² bis 12,3 µg/cm² gemessen.', 'In Probe 1 wurden 12,3 µg/cm² gemessen.']
        .map(t => LektorKern.analysieren({ bloecke: [], segs: [seg(t)] }, d).marken.filter(m => m.art === 'wert').map(m => m.text + ':' + m.status).join(' ')); });
    assert.deepEqual(sp, ['12,3 µg/cm²:ohne', '12,3 µg/cm²:ohne', '4,1 µg/cm²:ohne 12,3 µg/cm²:ohne', '12,3 µg/cm²:belegt']);
    const gk = await page.evaluate(() => { const d = { projekt: { name: '99.9002 X Tst', nr: '99.9002' }, messungen: [{ label: 'P1', p: 'Chlorid', u: 'µg/cm²', roh: '< 0,5', q: 'unter', v: 0.5, bericht: 'AR-1' }], berichte: [] };
      return LektorKern.analysieren({ bloecke: [], segs: [{ id: 0, text: 'Probe 1: Unter BG µg/cm².', art: 'p', teil: 'document', abschnitt: '5.2', titel: 'Korrosionsschäden' }] }, d).marken.filter(m => m.art === 'wert').map(m => m.text + ':' + m.status); });
    assert.deepEqual(gk, ['Unter BG µg/cm²:belegt']);
    // anderes Projekt öffnen, während ein Bericht zu sehen ist: der alte Bericht verschwindet sofort
    await pruefen(BR1.ordner);
    const weg = await page.evaluate(async () => { const root = await navigator.storage.getDirectory(), archiv = await root.getDirectoryHandle('Archiv');
      const p = LektorKitTest.oeffnen(await archiv.getDirectoryHandle('25.0100 Altweg 3 Altstadt Tst'), archiv);
      const sofort = document.getElementById('haupt').classList.contains('versteckt'); await p; await LektorKitTest.warteAndere();
      return [sofort, document.getElementById('haupt').classList.contains('versteckt'), LektorKitTest.zustand().erg]; });
    assert.deepEqual(weg, [true, true, null]);
    // während ein Projekt lädt: Ablage versteckt, ein Bericht wird nicht gelesen
    const lade = await page.evaluate(async b => { const root = await navigator.storage.getDirectory(), archiv = await root.getDirectoryHandle('Archiv');
      const p = LektorKitTest.oeffnen(await archiv.getDirectoryHandle('99.9002 Brandweg Beispielstadt Tst'), archiv);
      const versteckt = document.getElementById('berichtWahl').classList.contains('versteckt');
      await LektorKitTest.lesen(new File([Uint8Array.from(atob(b), c => c.charCodeAt(0))], 'hand.docx')); const doc = !!LektorKitTest.zustand().doc;
      await p; await LektorKitTest.warteAndere(); return [versteckt, doc, LektorKitTest.zustand().daten.projekt.name]; }, docxVonHand(['P1 12,3 µg/cm²']).toString('base64'));
    assert.deepEqual(lade, [true, false, '99.9002 Brandweg Beispielstadt Tst']);
    // Projekt lässt sich nicht lesen: es gilt trotzdem dieses (mit Hinweisen), nie die Daten des vorigen
    const kaputt = await page.evaluate(async b => { const root = await navigator.storage.getDirectory(), archiv = await root.getDirectoryHandle('Archiv');
      const falsch = { name: '99.9999 Kaputt Tst', kind: 'directory', values(){ throw new Error('Zugriff verweigert'); }, entries(){ throw new Error('Zugriff verweigert'); }, getDirectoryHandle(){ throw new Error('Zugriff verweigert'); }, getFileHandle(){ throw new Error('Zugriff verweigert'); } };
      await LektorKitTest.oeffnen(falsch, archiv);
      await LektorKitTest.lesen(new File([Uint8Array.from(atob(b), c => c.charCodeAt(0))], 'hand.docx'));
      const S = LektorKitTest.zustand(); return [S.dir && S.dir.name, S.daten && S.daten.projekt.name, (S.daten && S.daten.hinweise || []).some(h => /nicht lesbar/.test(h))]; }, docxVonHand(['P1 12,3 µg/cm²']).toString('base64'));
    assert.deepEqual(kaputt, ['99.9999 Kaputt Tst', '99.9999 Kaputt Tst', true], 'nie mit den Daten des vorigen Projekts');
    const mv = await page.evaluate(() => { const x = '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:moveFrom><w:r><w:t>alt 99 µg/cm² </w:t></w:r></w:moveFrom><w:moveTo><w:r><w:t>neu 12,3 µg/cm²</w:t></w:r></w:moveTo></w:p>';
      return LektorKern.absatzText(new DOMParser().parseFromString(x, 'application/xml').documentElement); });
    assert.equal(mv, 'neu 12,3 µg/cm²');
    // Bericht lesen und währenddessen ein anderes Projekt öffnen: der alte Bericht kommt nicht ins neue Projekt
    const v = await page.evaluate(async () => { const root = await navigator.storage.getDirectory(), archiv = await root.getDirectoryHandle('Archiv');
      await LektorKitTest.oeffnen(await archiv.getDirectoryHandle('99.9002 Brandweg Beispielstadt Tst'), archiv);
      const a = LektorKitTest.lesen(), b = LektorKitTest.oeffnen(await archiv.getDirectoryHandle('25.0100 Altweg 3 Altstadt Tst'), archiv);
      await Promise.all([a, b]); await LektorKitTest.warteAndere(); const S = LektorKitTest.zustand(); return [S.daten.projekt.name, S.doc ? 'Bericht' : 'keiner']; });
    assert.deepEqual(v, ['25.0100 Altweg 3 Altstadt Tst', 'keiner']);
  });

  await fall('k', 'Prüfprotokoll auf einer Seite', async () => {
    const docx = docxErsetzen(BR1_DOCX, [['<w:t xml:space="preserve">2300</w:t>', '<w:t xml:space="preserve">3200</w:t>']]);
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ docx }), ...archivBasis() }, MA);
    await pruefen(BR1.ordner);
    await page.emulateMedia({ media: 'print' });
    const text = await page.textContent('#protokoll'); assert.match(text, /Prüfprotokoll LektorKit/); assert.match(text, /3200/); assert.match(text, /offen/);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const seiten = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; assert.equal(seiten, 1, 'Seiten: ' + seiten);
    await page.emulateMedia({ media: 'screen' });
    fs.writeFileSync(path.join(OUT, 'pruefprotokoll.pdf'), pdf);
  });

  if (was === 'vorschau'){
    const docx = docxErsetzen(BR1_DOCX, [['<w:t xml:space="preserve">2300</w:t>', '<w:t xml:space="preserve">3200</w:t>'], ['Feinreinigung der Wand- und Bodenflächen.', 'Feinreinigung der Wand- und Bodenflächen wie im Objekt Lindenweg 4 beschrieben.']]);
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ docx }), ...archivBasis() }, MA);
    await pruefen(BR1.ordner);
    await page.evaluate(() => { const el = [...document.querySelectorAll('#seite .ueb')].find(x => /5\.2/.test(x.textContent)); el.scrollIntoView(); window.scrollBy(0, -10); });
    await page.click('#seite .m.abweicht'); await page.evaluate(() => { document.querySelector('#seite .m.gewaehlt').scrollIntoView({ block: 'center' }); });
    await page.screenshot({ path: path.join(ROOT, 'docs', 'vorschau.png') }); ok++; console.log('docs/vorschau.png geschrieben');
  }
  assert.deepEqual(fehler, [], 'Browserfehler');
  console.log(`${ok} Prüfungen grün`);
  await browser.close(); srv.close();
})().catch(async e => { console.error(e); try{ await browser.close(); }catch(_){} if (srv) srv.close(); process.exit(1); });
