'use strict';
// Keep the existing responsive-audit entry point. The learner now uses the same
// full-window HUD on every screen, so the reviewed artifact/hash guard, real
// native input checks and disposable browser fixture live in one audit.
const {run}=require('./practice-hud-production.cjs');
if(require.main===module)run({expectedWorkspaceSha256:process.env.ST_REVIEWED_WORKSPACE_SHA256}).then(report=>console.log(JSON.stringify({passed:report.passed,output:require('node:path').resolve(__dirname,'../../data/qa-studio/practice-hud-production')}))).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
