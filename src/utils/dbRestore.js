import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public', 'backups');

export const restoreDB = (archiveFileName) => {
  return new Promise((resolve, reject) => {
    const ARCHIVE_PATH = path.join(PUBLIC_DIR, archiveFileName);

    if (!fs.existsSync(ARCHIVE_PATH)) {
      return reject(new Error('Backup file not found'));
    }

    const MONGO_URI = process.env.MONGO_URI;

    const childProcess = spawn('mongorestore', [
      `--uri=${MONGO_URI}`,
      `--archive=${ARCHIVE_PATH}`,
      '--gzip',
      '--noIndexRestore',
      '--numInsertionWorkersPerCollection=1',
    ]);

    let fatalErrorOccurred = false;
    let fallbackErrorMessage = '';

    childProcess.stderr.on('data', (data) => {
      const logStr = data.toString().trim();
      console.log(`mongorestore log: ${logStr}`);

      if (logStr.toLowerCase().includes('error') || logStr.toLowerCase().includes('fatal')) {
        const isDuplicateKey = logStr.toLowerCase().includes('duplicate key');
        const isIndexError =
          logStr.toLowerCase().includes('index') && logStr.toLowerCase().includes('already exists');
        const isRestoringWarning = logStr
          .toLowerCase()
          .includes('restoring to existing collection');

        if (!isDuplicateKey && !isIndexError && !isRestoringWarning) {
          fatalErrorOccurred = true;
          fallbackErrorMessage = logStr;
        }
      }
    });

    childProcess.on('error', (error) => {
      console.error('Child process internal error:', error);
      reject(error);
    });

    childProcess.on('exit', (code) => {
      if (fatalErrorOccurred) {
        reject(new Error(`Restore failed: ${fallbackErrorMessage}`));
      } else {
        console.log('Database clean-merge sequence finished successfully.');
        resolve();
      }
    });
  });
};
