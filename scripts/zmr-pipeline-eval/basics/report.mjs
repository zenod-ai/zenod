#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {summarize} from './policy.mjs';
const {values:a}=parseArgs({options:{run:{type:'string'},review:{type:'string'},out:{type:'string'}}});
if(!a.run||!a.out)throw new Error('--run and new --out required');
const run=JSON.parse(await readFile(a.run,'utf8')),review=a.review?JSON.parse(await readFile(a.review,'utf8')):undefined;
if(review&&['candidateSha','fixtureSha256','rubricSha256'].some(k=>review[k]!==run[k]))throw new Error('Review version mismatch');
const report=summarize(run,review);
await writeFile(a.out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({verdict:report.verdict,passed:report.passed,denominator:report.denominator}));
