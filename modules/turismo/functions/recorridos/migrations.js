import {cloneData, fail} from '../../../../packages/contracts/index.js';
export function migrateRouteState(entry) { if (entry.schemaVersion !== 1) fail('state_migration_required', 'Unsupported route state version.'); return cloneData(entry); }
