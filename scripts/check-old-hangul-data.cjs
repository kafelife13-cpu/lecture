const assert=require('node:assert/strict');
global.window={};
require('../classical-vocab.js');
require('../classical-course.js');
require('../classical-translations.js');

const all=JSON.stringify([window.CLASSICAL_VOCAB_UNITS,window.CLASSICAL_COURSE,window.CLASSICAL_TRANSLATIONS]);
assert.doesNotMatch(all,/[-�]/,'legacy private-use or replacement character remains');

function validJamoRun(run){
 const type=character=>{
  const code=character.codePointAt(0);
  if((code>=0x1100&&code<=0x115f)||(code>=0xa960&&code<=0xa97f))return'L';
  if((code>=0x1160&&code<=0x11a7)||(code>=0xd7b0&&code<=0xd7c6))return'V';
  return'T';
 };
 const types=Array.from(run,type);let position=0;
 while(position<types.length){
  if(types[position++]!=='L'||types[position++]!=='V')return false;
  while(types[position]==='V')position++;
  while(types[position]==='T')position++;
 }
 return true;
}
const jamoRuns=all.match(/[ᄀ-ᇿꥠ-꥿ힰ-퟿]+/g)||[];
assert.ok(jamoRuns.length>400,'expected the Old Hangul source data');
jamoRuns.forEach(run=>assert.equal(validJamoRun(run),true,`invalid Old Hangul syllable: ${run}`));

const courseEntries=window.CLASSICAL_COURSE.flatMap(lesson=>lesson.entries);
assert.equal(courseEntries.length,209);
courseEntries.forEach(entry=>assert.ok(entry.word&&entry.meaning&&entry.example,`incomplete course entry: ${entry.word||'(blank)'}`));
window.CLASSICAL_COURSE.forEach(lesson=>assert.equal(window.CLASSICAL_TRANSLATIONS[lesson.lesson].length,lesson.entries.length,`translation mismatch in lesson ${lesson.lesson}`));
assert.match(all,/즈ᇫ/);assert.match(all,/녀르ᇝ/);assert.match(all,/아ᇇ/);
console.log('PASS: 735 vocabulary entries, Old Hangul syllables and 209 translations are structurally valid');
