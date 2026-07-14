#!/usr/bin/env node
'use strict';

const child=require('child_process');
const path=require('path');
const workspace=require('../../workspace');
const phases=require('./phases');

const before=workspace.snapshot(phases.ROOT,phases.PROTECTED);
function run(args){const result=child.spawnSync(process.execPath,args,{cwd:phases.ROOT,encoding:'utf8',stdio:'inherit'});if(result.status!==0)throw new Error(`command failed (${result.status}): node ${args.join(' ')}`)}
run(['evals/lantern-line-eval.js']);
run(['evals/lantern-line-benchmark.js']);
run(['factory/experiments/lantern-line-v1/cli.js','all']);
run(['factory/experiments/lantern-line-v1/verify-artifact.js']);
run(['factory/experiments/lantern-line-v1/mutation-eval.js']);
run(['factory/experiments/lantern-line-v1/promote.js']);
run(['factory/experiments/lantern-line-v1/verify-promotion.js']);
run(['factory/experiments/lantern-line-v1/promotion-mutation-eval.js']);
run(['factory/experiments/lantern-line-v1/export-evidence.js','export',path.join(phases.OUT,'evidence-package')]);
run(['factory/experiments/lantern-line-v1/export-evidence.js','verify',path.join(phases.OUT,'evidence-package')]);
run(['factory/experiments/lantern-line-v1/export-evidence.js','mutations',path.join(phases.OUT,'evidence-package')]);
const after=workspace.snapshot(phases.ROOT,phases.PROTECTED);if(before.sha256!==after.sha256)throw new Error('focused Foundry eval changed protected catalog or reviewed artifacts');
console.log('LANTERN LINE FOUNDRY EVAL PASSED');
