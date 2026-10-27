'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wgb-api-'));
process.env.WGB_DB_PATH=path.join(temp,'database.json');process.env.OPENAI_API_KEY='';process.env.PORT='0';
const {server}=require('../server');
let base;
before(async()=>{if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});});
const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('chat accepts a long message without cutting off its final condition',async()=>{
 const message='Подробности поездки. '.repeat(130)+' Не подтверждай бронирование.';
 const response=await post('/api/chat',{sessionId:'api_long',message});assert.equal(response.status,200);
 const history=await (await fetch(base+'/api/chat/history/api_long')).json();assert.equal(history.messages[0].content,message);
});
test('oversized message is rejected explicitly',async()=>{const response=await post('/api/chat',{sessionId:'api_limit',message:'x'.repeat(8001)});assert.equal(response.status,400);assert.match((await response.json()).error,/слишком длинное/);});
test('database and server source cannot be downloaded as static files',async()=>{
 for(const route of ['/data/database.json','/server.js','/services/aiService.js','/package.json'])assert.equal((await fetch(base+route)).status,404);
});
test('public database endpoint is safe and calculator uses its tariffs',async()=>{
 const response=await fetch(base+'/api/agent/knowledge');assert.equal(response.status,200);const body=await response.json();assert.equal(body.pricing.status,'demo');assert.equal(body.apiKey,undefined);
 const result=await (await post('/api/calculator/calculate',{start:'2027-11-03',end:'2027-11-05',guests:20,occupancy:2,mealKey:'breakfast'})).json();assert.equal(result.data.total,760000);assert.equal(result.data.preliminary,true);
});
test('contact form rejects missing consent without creating a lead',async()=>{const response=await post('/api/lead',{name:'Test',phone:'Test'});assert.equal(response.status,400);assert.match((await response.json()).error,/согласие/);});
test('pricing administration requires authentication',async()=>{assert.equal((await fetch(base+'/api/admin/pricing')).status,401);});
