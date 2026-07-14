#!/usr/bin/env node
'use strict';

const path=require('path');
const canonical=require('../../canonical');
const store=require('../../store');
const workspace=require('../../workspace');
const adapter=require('../../adapters/lantern-line');
const verify=require('./verify-artifact');
const phases=require('./phases');

const artifact=process.argv[2]?path.resolve(process.argv[2]):phases.experimentPath(),report=verify.verifyArtifact(artifact);
if(!report.ok)throw new Error('refusing promotion: '+report.failures.join('; '));
const experiment=store.readJson(artifact),sourcePath=path.join(phases.ROOT,'lantern-line.html'),beforeHash=workspace.fileHash(sourcePath),sourceEntry=experiment.source.inputManifest.entries.find(entry=>entry.path==='lantern-line.html');
if(!sourceEntry||sourceEntry.sha256!==beforeHash)throw new Error('shipping source no longer matches experiment baseline');
let action='retain-incumbent',patch=null,afterHash=beforeHash;
if(phases.key(experiment.selection.genome)!==phases.key(experiment.incumbentGenome)){action='promote-candidate';patch=adapter.applyGenome(phases.ROOT,experiment.selection.genome);afterHash=workspace.fileHash(sourcePath);if(afterHash!==experiment.selection.candidateSourceHash)throw new Error('promoted source does not match selected candidate source hash')}
else if(experiment.selection.candidateSourceHash!==beforeHash)throw new Error('retained incumbent source hash does not match selection');
const receipt={schema:'arcade-foundry-promotion/v1',action,experimentPayloadSha256:experiment.payloadSha256,experimentFileSha256:workspace.fileHash(artifact),genome:experiment.selection.genome,beforeHash,afterHash,patch,protectedManifest:workspace.snapshot(phases.ROOT,phases.PROTECTED)};receipt.payloadSha256=canonical.hash(receipt);
const file=path.join(path.dirname(artifact),'promotion.json');store.writeArtifact(file,receipt);console.log(JSON.stringify({promotion:file,action,payloadSha256:receipt.payloadSha256,genome:receipt.genome,afterHash},null,2));
