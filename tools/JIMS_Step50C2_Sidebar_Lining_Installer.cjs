#!/usr/bin/env node
// JIMS Step 50C.2 — thin, premium sidebar separators only.
// ONLY app/src/JIMSDashboardHome.css is written. No PV/CV/Delegation/login/App code edits.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root='/workspaces/Jauhar';
const branch='jsync-gui-revamp-20261029';
const rel='app/src/JIMSDashboardHome.css';
const file=path.join(root,rel);
const prevBlob='617ac89a4c1b9a360d0b7ed62713ef49c4ba8099';
const latestBlob='b5c279d9104881d02ae9d0ef7d461d318b7e315a';
function git(...args){return cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trimEnd()}
function stop(msg){console.error('STOP: '+msg);process.exit(1)}
if(!fs.existsSync(file))stop('Dashboard CSS not found');
if(git('branch','--show-current')!==branch)stop('Wrong branch; must be '+branch);
const current=fs.readFileSync(file,'utf8');
const currentBlob=git('hash-object',rel);
if(currentBlob===latestBlob){console.log('Sidebar lining already installed. No change.');process.exit(0)}
if(currentBlob!==prevBlob)stop('Local CSS differs from the last approved version; refusing overwrite. Share git hash-object result.');
const next=git('show','origin/'+branch+':gui-patches/50C/JIMSDashboardHome.css')+'\n';
if(!next.includes('JIMS Step 50C.2 — subtle premium sidebar dividers') ||
 !next.includes('border-right:1px solid rgba(208,170,98,.19)') ||
 !next.includes('border-bottom:1px solid rgba(208,170,98,.16)'))stop('Expected new sidebar CSS not found in GitHub branch.');
if(process.argv.includes('--dry-run')){console.log('DRY RUN PASS: update only '+rel);process.exit(0)}
const backup=file+'.backup_before_50C2_'+new Date().toISOString().replace(/[:.]/g,'-');
fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
try{
 fs.writeFileSync(file,next);
 cp.execFileSync('npm',['run','build'],{cwd:path.join(root,'app'),stdio:'inherit'});
 console.log('SIDEBAR LINING INSTALLED. Backup: '+path.basename(backup));
 console.log('Unaffected: login, App.jsx, PV, CV, Delegation, Supabase.');
}catch(e){
 fs.copyFileSync(backup,file);
 stop('Build failed; original CSS restored. '+e.message);
}
