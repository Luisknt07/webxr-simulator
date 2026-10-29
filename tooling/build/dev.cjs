'use strict';
// Production server boundaries are also used in development. Rebuild explicitly
// while working; do not expose a repository-root webpack development server.
const {spawnSync}=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const build=spawnSync(process.execPath,[path.join(__dirname,'build.cjs')],{cwd:root,stdio:'inherit',windowsHide:true});if(build.status!==0)process.exit(build.status||1);
const server=spawnSync(process.execPath,[path.join(root,'apps/api/index.cjs')],{cwd:root,stdio:'inherit',env:{...process.env,SMARTTWIN_ALLOW_INSECURE_LOCAL:'true'},windowsHide:true});process.exit(server.status||0);
