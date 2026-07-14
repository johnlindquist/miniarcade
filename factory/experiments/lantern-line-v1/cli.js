#!/usr/bin/env node
'use strict';

const phases=require('./phases');
const command=process.argv[2]||'all';

function line(label,result){console.log(`${label}: ${result.path}`);if(result.record)console.log(JSON.stringify({payloadSha256:result.record.payloadSha256,claimDecision:result.record.claimDecision,selected:result.record.selected,cost:result.record.cost},null,2));if(result.experiment)console.log(JSON.stringify({payloadSha256:result.experiment.payloadSha256,status:result.experiment.status,selection:result.experiment.selection,cost:result.experiment.cost},null,2))}

if(command==='discover')line('discovery',phases.discover());
else if(command==='memory-on')line('memory-on',phases.search('memory-on'));
else if(command==='memory-off')line('memory-off',phases.search('memory-off'));
else if(command==='assemble')line('experiment',phases.assemble());
else if(command==='all'){
  line('discovery',phases.discover());
  line('memory-on',phases.search('memory-on'));
  line('memory-off',phases.search('memory-off'));
  line('experiment',phases.assemble());
}else throw new Error(`usage: node ${process.argv[1]} [discover|memory-on|memory-off|assemble|all]`);
