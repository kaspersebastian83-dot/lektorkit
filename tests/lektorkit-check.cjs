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
//  l  Codex-Befunde PR #1: fehlender Bericht im Link → nichts lesen; alte Übernahme mit gelöschter -02 macht -01 nicht „überholt“
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
    const docx = docxErsetzen(BR1_DOCX, [['Die Ergebnisse sind in Tabelle 1 zusammengefasst.', 'An den Proben 1 und 2 wurden zusammen 16,4 µg/cm² ermittelt. Die Ergebnisse sind in Tabelle 1 zusammengefasst.']]);
    await archivAnlegen({ [BR1.ordner]: br1Dateien({ docx }), ...archivBasis() }, MA);
    const r = await pruefen(BR1.ordner), m = finde(r, 'wert', '16,4 µg/cm²');
    assert.equal(m.length, 1); assert.equal(m[0].status, 'ohne'); assert.match(m[0].notiz, /Mehrere Proben/);
    assert.deepEqual(offen(r), [], 'ohne Beleg ist kein Problem:\n' + zeig(r)); assert.equal(r.kopf, 'Keine Abweichung gefunden');
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
