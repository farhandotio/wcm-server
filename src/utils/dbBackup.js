import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public', 'backups');

export const backupDB = () => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PUBLIC_DIR)) {
      fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    }

    const now = new Date();
    const timestamp = now
      .toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .split('.')[0]
      .slice(0, 16);
    const FILE_NAME = `wcm_${timestamp}.gzip`;
    const ARCHIVE_PATH = path.join(PUBLIC_DIR, FILE_NAME);

    const MONGO_URI = process.env.MONGO_URI;

    const childProcess = spawn('mongodump', [
      `--uri=${MONGO_URI}`,
      `--archive=${ARCHIVE_PATH}`,
      '--gzip',
    ]);

    childProcess.stderr.on('data', (data) => {
      console.log(`mongodump log: ${data.toString().trim()}`);
    });

    childProcess.on('error', (error) => {
      reject(error);
    });

    childProcess.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Backup failed with exit code ${code}`));
      } else {
        console.log(`Database backup created successfully: ${FILE_NAME}`);
        resolve({ fileName: FILE_NAME, path: ARCHIVE_PATH });
      }
    });
  });
};
