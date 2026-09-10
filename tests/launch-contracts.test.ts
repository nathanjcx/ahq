import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateRoadmap } from '../desktop/planning';
import { DemoTriggerSchema } from '../desktop/demo';
import { verifyLaunchForecast } from '../desktop/launch-finance';
import { mergeWorkspace } from '../shared/workspaceMerge';
import { initialState } from '../src/lib/store';

const stages = ['product','marketing','forecast'] as const;
const milestones = () => stages.map((launchStep,index) => ({ key:launchStep,launchStep,taskKind:['product','meeting','report'][index],title:`Little Office ${launchStep}`,description:'Create the actual deliverable using supplied launch source files.',ownerId:'',dayOffset:1,dependencies:[],definitionOfDone:'Real files pass the local verification.',nextStep:'Read the launch brief and input files.' }));
test('real launch planner contract produces three typed parallel tasks and rejects dropped responsibilities',async()=>{
 const input = {goal:'Launch Little Office',employees:[],automatic:true,launchId:'launch-a'};
 const plan = await generateRoadmap(async(prompt)=>{assert.match(prompt,/LITTLE OFFICE LAUNCH/);return JSON.stringify({milestones:milestones()});},input);
 assert.deepEqual(plan.map(task=>task.launchStep),stages);assert(plan.every(task=>task.launchId==='launch-a' && task.dependencies.length===0));
 const bad=milestones();bad[2].launchStep='product';
 await assert.rejects(generateRoadmap(async()=>JSON.stringify({milestones:bad}),input),/independent product/);
});
test('screenshots require canonical base64 PNG or JPEG, text stays bounded',()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
 assert(DemoTriggerSchema.safeParse({kind:'slack',attachments:[{name:'bug.png',mediaType:'image/png',encoding:'base64',content:png}]}).success);
 assert(!DemoTriggerSchema.safeParse({kind:'slack',attachments:[{name:'bug.png',mediaType:'image/png',encoding:'base64',content:'hello'}]}).success);
 assert(!DemoTriggerSchema.safeParse({kind:'email',attachments:[{name:'a.txt',mediaType:'text/plain',content:'a'.repeat(64001)}]}).success);
});
test('forecast checks numerical output and stale renders cannot undo a restored checkpoint',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'launch-finance-'));
 try {
  const row=['2026-10',120,12,1440,288,1800,-648];
  await writeFile(path.join(directory,'forecast-contract.json'),JSON.stringify({baseline:[row],revised:[row]}));
  const csv='month,customers,price_usd,revenue_usd,cost_usd,marketing_spend_usd,operating_contribution_usd\n'+row.join(',')+'\n';
  await writeFile(path.join(directory,'forecast.csv'),csv);
  const task={kind:'report' as const,title:'Forecast',files:[],launchStep:'forecast' as const};
  assert.match((await verifyLaunchForecast(directory,task,directory)).title,/verified CSV/);
  await writeFile(path.join(directory,'forecast.csv'),csv.replace('1440','1441'));
  await assert.rejects(verifyLaunchForecast(directory,task,directory),/revenue_usd/);
  const current={...initialState(),launchRestoreId:'restored'};
  const stale={...current,launchRestoreId:undefined,goal:'stale'};
  assert.equal(mergeWorkspace(current,stale),current);
 }finally{await rm(directory,{recursive:true,force:true});}
});
