import {cloneData, fail} from '../../../../packages/contracts/index.js';
export function migrateAssessmentState(entry) { if (entry.schemaVersion !== 1) fail('state_migration_required', 'Unsupported assessment state version.'); return cloneData(entry); }
