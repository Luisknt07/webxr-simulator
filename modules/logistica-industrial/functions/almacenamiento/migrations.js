import {cloneData, fail} from '../../../../packages/contracts/index.js';
export function migrateStorageState(entry) { if (entry.schemaVersion !== 1) fail('state_migration_required', 'This storage schema needs an explicit compatible migration.'); return cloneData(entry); }
