const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function myAnnounceItems(){'),html.indexOf('function renderSAnnounceList('));
const c={session:{school_id:'sc_hanbaek',group_id:'hanbaek_wed_1800'},announceDb:{items:[{id:'an_1792925427850',school_id:'sc_hanbaek'},{id:'an_1792925445084',school_id:'sc_chidong'},{id:'old',school_id:'sc_hanbaek'}]}};
vm.createContext(c);vm.runInContext(source,c);
assert.deepEqual(Array.from(c.myAnnounceItems(),a=>a.id),['old']);
for(const group of ['hanbaek_sat_1030','hanbaek_sat_1430','hanbaek_sun_1030']){c.session.group_id=group;assert.equal(c.myAnnounceItems()[0].id,'an_1792925427850');}
c.session={school_id:'sc_chidong',group_id:'chidong_sun_1430'};
assert.deepEqual(Array.from(c.myAnnounceItems(),a=>a.id),['an_1792925445084']);
console.log('PASS: Wednesday lesson group excluded; weekend school notices and prior notices preserved');
