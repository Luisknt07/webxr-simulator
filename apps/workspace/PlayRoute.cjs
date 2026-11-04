'use strict';
// Shared by HTTP routing and browser navigation. Filters/settings alone never
// authorize starting the default world; a concrete selection must be present.
const SELECTIONS=['practice','scene','libraryScene','project'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const navigation=require('../../modules/logistica-industrial/practices/schema/PracticeNavigation.cjs');
function hasPlaySelection(params){return SELECTIONS.some(key=>ID.test(params.get(key)||''));}
function playEntry(params){return hasPlaySelection(params)?'index.html':'catalogue.html';}
module.exports={hasPlaySelection,playEntry,practiceURL:navigation.practiceURL,readPracticeSettings:navigation.readPracticeSettings};
