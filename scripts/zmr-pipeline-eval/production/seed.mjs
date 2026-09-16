#!/usr/bin/env node
// Local fixture materialization only. No Git, provisioning, credentials or network.
import {readFile,mkdir,writeFile} from 'node:fs/promises';import {join,dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
export function seedFiles(fixture){return {...fixture.seedPages,'.brain/config.yml':'schema_version: 1\ntags: []\nconfidence_threshold: 0.7\n','Index.md':'# Synthetic M2 memory\n\n'+Object.keys(fixture.seedPages).map(p=>'[['+p.slice(0,-3)+']]').join('\n')};}
export async function seed(target){const fixture=JSON.parse(await readFile(new URL('../basics/fixture.json',import.meta.url)));await mkdir(target,{mode:0o700});for(const [path,text]of Object.entries(seedFiles(fixture))){await mkdir(dirname(join(target,path)),{recursive:true});await writeFile(join(target,path),text,{flag:'wx',mode:0o600});}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(!process.argv[2])throw Error('New local seed directory required');await seed(resolve(process.argv[2]));}
