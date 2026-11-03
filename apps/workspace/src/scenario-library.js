import ScenarioLibraryPage from './ScenarioLibraryPage.js';
const page=new ScenarioLibraryPage({document,window});
window.smartTwinScenarioLibrary=Object.freeze({get ready(){return page.ready;},getStats:()=>page.getStats()});
