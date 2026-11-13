#!/usr/bin/env node
// Vorlage aus BerichtKits eigenem Code (wie GlasKits Vorlage aus PlanKit): node tests/vorlage-berichtkit.cjs [../berichtkit]
// Schreibt tests/fixtures/berichtkit-br1.docx – den echten Brandbericht, den BerichtKit aus seinen ERFUNDENEN Testdaten „BR1_voll_Versicherung“
// (tests/daten/brand.cjs) baut – und tests/fixtures/berichtkit-br1.json mit genau diesen Daten (_Projekt.json, LabelKit, _Ergebnisse.json).
// Die Dateien sind erzeugt, nicht von Hand ändern. Bei Änderungen am Brandbericht neu erzeugen und Prüfung b laufen lassen.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const BK = path.resolve(process.argv[2] || process.env.BERICHTKIT || path.join(__dirname, '..', '..', 'berichtkit'));
const T = require(path.join(BK, 'bericht-text.js')), W = require(path.join(BK, 'bericht-docx.js'));
const B = require(path.join(BK, 'tests', 'daten', 'beispiel.cjs')), BD = require(path.join(BK, 'tests', 'daten', 'brand.cjs'));
const D = vm.runInThisContext('(function(){' + fs.readFileSync(path.join(BK, 'vendor', 'docx.iife.js'), 'utf8') + '\n;return docx;})()');
const ZIEL = path.join(__dirname, 'fixtures'); fs.mkdirSync(ZIEL, { recursive: true });
(async () => {
  const f = BD.faelle.BR1_voll_Versicherung, m = T.bericht({ cfg: B.cfg, mitarbeiter: B.mitarbeiter, ...f });
  const foto = { data: fs.readFileSync(path.join(BK, 'tests', 'daten', 'testfoto.jpg')), w: 480, h: 320 }, fotos = {};
  for (const a of m.abschnitte) for (const x of a.inhalt) if (x.t === 'fig') fotos[x.label] = foto;
  const bilder = { logoSvg: fs.readFileSync(path.join(BK, 'assets', 'logo-schiffers.svg')), logoPng: fs.readFileSync(path.join(BK, 'assets', 'logo-schiffers.png')), sig: {}, fotos };
  const buf = await D.Packer.toBuffer(W.erstellen(D, m, { ...bilder, kommentare: true }));
  fs.writeFileSync(path.join(ZIEL, 'berichtkit-br1.docx'), buf);
  const git = (() => { try{ return require('node:child_process').execSync('git -C ' + JSON.stringify(BK) + ' rev-parse --short HEAD').toString().trim(); }catch(e){ return '?'; } })();
  fs.writeFileSync(path.join(ZIEL, 'berichtkit-br1.json'), JSON.stringify({ erzeugt: 'tests/vorlage-berichtkit.cjs aus BerichtKit ' + git + ' (erfundene Testdaten BR1_voll_Versicherung)',
    ordner: BD.ORDNER, pj: f.pj, lk: f.lk, erg: f.erg }, null, 1) + '\n');
  console.log('Vorlage geschrieben:', buf.length, 'Bytes, BerichtKit', git, '– Lücken:', m.luecken.join(' '));
})();
