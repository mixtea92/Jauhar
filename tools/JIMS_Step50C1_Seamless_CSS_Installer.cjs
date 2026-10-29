#!/usr/bin/env node
// JIMS Step 50C.1 — apply GitHub-reviewed seamless CSS to Codespaces, safely.
// CSS-only, never edits App.jsx/PV/CV/Delegation/login/permissions/Supabase.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const cwd='/workspaces/Jauhar',rel='app/src/JIMSDashboardHome.css';
const target=path.join(cwd,rel),branch='jsync-gui-revamp-20261029';
const oldBlob='5dd9b4e3db2a82961bff9b2b1f41fe32d6f90bdc';
const git=(...args)=>cp.execFileSync('git',args,{cwd,encoding:'utf8'}).trimEnd();
const fail=m=>{console.error('STOP: '+m);process.exit(1)};
if(!fs.existsSync(target))fail('Dashboard CSS missing in Codespaces');
if(git('branch','--show-current')!==branch)fail('Wrong branch. Expected '+branch);
const newCss=git('show','origin/'+branch+':gui-patches/50C/JIMSDashboardHome.css')+'\n';
const current=fs.readFileSync(target,'utf8');
if(current.trimEnd()===newCss.trimEnd()){console.log('Already seamless — nothing to change.');process.exit(0)}
const blob=git('hash-object',rel);
if(blob!==oldBlob)fail('Dashboard CSS differs from the checked baseline. Nothing overwritten.');
if(!newCss.includes('seamless premium shell')||!newCss.includes('border-right:0;')||!newCss.includes('border-bottom:0;background:#0b0c0e'))fail('Remote seamless patch not recognised');
if(process.argv.includes('--dry-run')){console.log('DRY RUN PASS: one CSS-only change. No files changed.');process.exit(0)}
const backup=target+'.backup_before_50C1_'+new Date().toISOString().replace(/[:.]/g,'-');
fs.copyFileSync(target,backup,fs.constants.COPYFILE_EXCL);
try{
 fs.writeFileSync(target,newCss);
 cp.execFileSync('npm',['run','build'],{cwd:path.join(cwd,'app'),stdio:'inherit'});
 console.log('JIMS seamless GUI CSS INSTALLED; backup: '+path.basename(backup));
 console.log('PV, CV, Delegation, login, App.jsx untouched.');
}catch(e){
 fs.copyFileSync(backup,target);
 fail('Build failed; original CSS restored. '+e.message);
}
