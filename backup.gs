// Install in a NEW standalone Google Apps Script project. Never writes to the source.
const SOURCE_ID = '1IrLRJVWarQJt-ALBO4GObIJrEopxfnBa4I9xRcQ2XRs';
const TAB = 'gym_tracker_app';
const TZ = 'Europe/Helsinki';
const KEEP_DAYS = 15;
const PREFIX = 'gym_tracker_backup_';
const TAG = 'gym-tracker-snapshot-v1:' + SOURCE_ID;
const HEADERS = ['id','date','exercise','weight_kg','reps','sets','note','created_at','updated_at','deleted_at','category'];

function installGymBackup() {
  backupGymDaily(); // First successful backup before setting the schedule.
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'backupGymDaily').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupGymDaily').timeBased().everyDays(1).atHour(3).inTimezone(TZ).create();
}

function backupGymDaily() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = SpreadsheetApp.openById(SOURCE_ID).getSheetByName(TAB);
    if (!sh || sh.getLastRow() < 2) throw new Error('Journal missing or empty. Existing backups left intact.');
    const values = sh.getRange(1, 1, sh.getLastRow(), HEADERS.length).getValues();
    if (!HEADERS.every((h,i) => values[0][i] === h)) throw new Error('Unexpected journal schema. Existing backups left intact.');
    const rows = values.slice(1).filter(r => r[0] !== '');
    if (!rows.length || new Set(rows.map(r => String(r[0]))).size !== rows.length) throw new Error('Empty journal or duplicate IDs. Existing backups left intact.');
    const now = new Date(), day = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const props = PropertiesService.getScriptProperties();
    let folder;
    const folderId = props.getProperty('GYM_BACKUP_FOLDER_ID');
    if (folderId) folder = DriveApp.getFolderById(folderId);
    else {
      folder = DriveApp.createFolder('Gym Tracker Backups');
      props.setProperty('GYM_BACKUP_FOLDER_ID', folder.getId());
    }
    const filename = PREFIX + day + '.json';
    const payload = JSON.stringify({version:1,exportedAt:now.toISOString(),sheet:TAB,headers:HEADERS,rows:rows});
    const same = folder.getFilesByName(filename);
    let validToday = false;
    while(same.hasNext()) {
      const f = same.next();
      if(f.getDescription() === TAG) {
        try {
          const p = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
          if(p.sheet === TAB && Array.isArray(p.rows) && p.rows.length && p.headers.join('|') === HEADERS.join('|')) validToday = true;
        } catch(e) {}
      }
    }
    if (!validToday) {
      const file = folder.createFile(filename, payload, MimeType.PLAIN_TEXT);
      file.setDescription(TAG);
      const check = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
      if (check.rows.length !== rows.length) throw new Error('Backup verification failed; no cleanup performed.');
    }
    // Only files in this dedicated folder, with our exact tag and name, are eligible.
    const cutoff = new Date(day + 'T12:00:00Z');
    cutoff.setUTCDate(cutoff.getUTCDate() - (KEEP_DAYS - 1));
    const oldest = Utilities.formatDate(cutoff, 'UTC', 'yyyy-MM-dd');
    const files = folder.getFiles();
    while(files.hasNext()) {
      const f = files.next();
      const m = /^gym_tracker_backup_(\d{4}-\d{2}-\d{2})\.json$/.exec(f.getName());
      if (f.getId() !== SOURCE_ID && f.getDescription() === TAG && m && m[1] < oldest) f.setTrashed(true);
    }
    console.log('Backup verified: ' + rows.length + ' rows. Folder: ' + folder.getUrl());
  } finally { lock.releaseLock(); }
}
