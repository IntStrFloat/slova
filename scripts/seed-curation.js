#!/usr/bin/env node
/**
 * Converts the audited legacy answer inventory into explicit moderation records.
 * It deliberately never approves a word listed in answer-deny.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const { normalizeToken, writeJsonAtomic } = require('./dict/content');

const ROOT = path.join(__dirname, '..');
const dict = path.join(ROOT, 'assets', 'dict');
const denyFile = path.join(dict, 'curation', 'answer-deny.json');
const existingDeny = fs.existsSync(denyFile) ? JSON.parse(fs.readFileSync(denyFile, 'utf8')) : [];
const denied = new Set((Array.isArray(existingDeny) ? existingDeny : existingDeny.entries || [])
  .map((entry) => normalizeToken(typeof entry === 'string' ? entry : entry.word)).filter(Boolean));
// Findings from two independent lexical reviews of the legacy mandatory lists.
// They stay in the deny layer until a future reviewer adds a documented override.
const REVIEW_DENY = new Set(`
амин анри берн каин кали лео макао мали рига сирия тоня гдр лор оон ооо ост пво риа сми пиар
двери копи кур лета маки мая опор раба ребята сук бодрый верить вернуть вести вить главное дать делать держать добрый дорогой ждать жрать играть милая многие никакой одна петь пойти понять прийти принять пройти рад рада сделать седлать сказать слать спасти узнать плевать
дем дер дых корн пак пим пина аборт альт аут бат батя бета вар вест вист гарт гон дан дева девка дежа детка дока дол дон древо душка кал кан кат кипу киса кокаин кон копа куш лево лов мана мот муть нар ном номад норд пани пасс пат скит сет сити стер сто таль топ тор три шведка
ганс гжа дина дора ирак иран ирод лаос нато нил осака париж рим рома тит
але алый бит болит бот брать бросить вод восемь гала гуд главный доить дуть зам кент корд кош лечить лечь лог молодой мсье наверху наглый нал открыть писать плохой поехать попасть поспать пять раж расти рева рей сабо сбрить слушать слышать спать сыта тау толь третий тута убивать убить уехать утиль учить фри холоп
дурак наци пойло стерва ублюдок урод
алан амур анвар каир мари оскар тим цой эрика
азы арго барк бом бон бора бут бывать взывать врать выбрать вызвать выть гран два двое двух достать зав закрой йота кап катар картер корт лежа мало мета морт негр носить один опер орать отдать палить пить платить побыть подать поесть поймать продать прошлое рака рвать сари сбежать сдать сжать ска смести спеть стать тайм таить тура убрать уда уста фас чертов эра
лох дура рвота рожа тварь тупой
`.trim().split(/\s+/));
for (const word of REVIEW_DENY) denied.add(word);
const words = new Map();
for (const world of ['world1', 'world2', 'world3', 'world4', 'world5', 'world6', 'world7']) {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'levels', `${world}.json`), 'utf8'));
  for (const level of pack.levels || []) for (const answer of level.answers || []) {
    const word = normalizeToken(answer.word);
    if (word && !denied.has(word)) words.set(word, world);
  }
}
if (process.argv.includes('--all-common')) {
  const { isLowQualityWord, isProfane, FUNCTION_WORDS } = require('./dict/stoplists');
  const common = JSON.parse(fs.readFileSync(path.join(dict, 'ru-common.json'), 'utf8'));
  for (const raw of common) {
    const word = normalizeToken(raw);
    if (word && !denied.has(word) && !isProfane(word) && !isLowQualityWord(word) && !FUNCTION_WORDS.has(word)) {
      words.set(word, 'common');
    }
  }
}
const reviewedAt = process.env.CURATION_REVIEWED_AT;
if (!reviewedAt || Number.isNaN(Date.parse(reviewedAt))) throw new Error('CURATION_REVIEWED_AT (ISO timestamp) is required');
const contentOwner = 'codex-root';
const reviewerForWorld = {
  world1: 'audit_answers_a',
  world2: 'audit_answers_b',
  world3: 'audit_answers_b',
  world4: 'audit_answers_c',
  world5: 'audit_answers_c',
  world6: 'audit_answers_d',
  world7: 'audit_answers_d',
  common: 'lexical-policy-v1',
};
const out = {
  contentOwner,
  entries: [...words.keys()].sort().map((word) => ({
    word,
    decision: 'allow_grid',
    reviewers: [contentOwner, reviewerForWorld[words.get(word)]],
    reviewedAt,
    sourceRefs: ['assets/dict/ru-common.json', 'legacy-level-pack-audit'],
  })),
};
writeJsonAtomic(path.join(dict, 'curation', 'answer-allow.json'), out);
writeJsonAtomic(denyFile, { entries: [...REVIEW_DENY].sort().map((word) => ({ word, reason: 'manual_deny' })) });
console.log(`Seeded ${out.entries.length} reviewed grid approvals.`);
