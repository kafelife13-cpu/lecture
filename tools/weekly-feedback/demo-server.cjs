'use strict';
// Synthetic-only loopback preview. This is deliberately not a production login server.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const E=require('./engine.cjs'),{fixture}=require('./fixture.cjs');
function createDemo(directory){
 const d=fixture(1),packet=E.approve(E.plan({...d,student:d.students[0]}),'synthetic-reviewer');
 fs.mkdirSync(directory,{recursive:true});const ledger=path.join(directory,'synthetic-week-submission.json');
 return http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||''))return send(403,{error:'Loopback only'});
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Origin denied'});
  try{
   if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",'Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'demo.html')));}
   if(req.method==='GET'&&req.url==='/demo.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'demo.js')));}
   if(req.method==='GET'&&req.url==='/api/packet')return send(200,{packet:E.studentView(packet),result:fs.existsSync(ledger)?E.studentResult(packet,JSON.parse(fs.readFileSync(ledger,'utf8'))):null});
   if(req.method==='POST'&&req.url==='/api/submit'){
    if(req.headers['content-type']!=='application/json')return send(415,{error:'JSON required'});
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return send(413,{error:'Too large'});}
    const input=JSON.parse(body),previous=fs.existsSync(ledger)?E.studentResult(packet,JSON.parse(fs.readFileSync(ledger,'utf8'))):null;
    const result=E.submit(packet,packet.student_id,input.answers,previous);
    if(!previous){try{fs.writeFileSync(ledger,JSON.stringify(result),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;return send(200,E.studentResult(packet,JSON.parse(fs.readFileSync(ledger,'utf8'))));}}
    return send(200,result);
   }
   if(req.method==='POST'&&req.url==='/api/blank'){
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return send(413,{error:'Too large'});}
    const input=JSON.parse(body),q=packet.blanks.find(q=>q.id===input.id);if(!q)return send(404,{error:'Unknown question'});
    return send(200,{correct:E.blankGrade(q,input.answer),explanation:q.explanation});
   }
   send(404,{error:'Not found'});
  }catch{send(400,{error:'요청 형식이나 OX 답안 20개를 확인하세요.'});}
 });
}
if(require.main===module){const directory=process.argv[2];if(!directory)throw Error('Specify private demo output directory');const port=Number(process.env.PORT||8787);createDemo(directory).listen(port,'127.0.0.1',()=>console.log(`Synthetic preview: http://127.0.0.1:${port}`));}
module.exports={createDemo};
