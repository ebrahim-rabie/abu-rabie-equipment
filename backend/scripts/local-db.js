/**
 * Starts a real local MongoDB for development.
 *
 * There is no MongoDB installed on this machine and no Docker, but
 * mongodb-memory-server already downloaded a mongod binary for the test suite.
 * This reuses that same binary as a normal, persistent server so the app can be
 * run and seeded the same way it will behave on Atlas.
 *
 *   npm run db
 *
 * Data is written to backend/.mongo-data (gitignored). Stop with Ctrl+C.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.LOCAL_DB_PORT) || 27017;
const DB_NAME = process.env.LOCAL_DB_NAME || 'abu_rabie';
const DB_PATH = path.join(__dirname, '..', '.mongo-data');

/**
 * Candidate locations for mongod, in priority order:
 *   1. an explicit MONGODB_BIN
 *   2. mongod on PATH
 *   3. the binary mongodb-memory-server downloaded for the test suite
 *   4. a plain install under Program Files
 */
const findMongod = () => {
  if (process.env.MONGODB_BIN && fs.existsSync(process.env.MONGODB_BIN)) {
    return process.env.MONGODB_BIN;
  }

  const names = process.platform === 'win32' ? ['mongod.exe'] : ['mongod'];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  const caches = [
    path.join(__dirname, '..', 'node_modules', '.cache', 'mongodb-binaries'),
    path.join(os.homedir(), '.cache', 'mongodb-binaries'),
  ];

  for (const cache of caches) {
    if (!fs.existsSync(cache)) continue;
    const binaries = fs
      .readdirSync(cache)
      // mongodb-memory-server stores the binary as mongod-x64-win32-<version>.exe,
      // not as the plain mongod.exe an installed server would use.
      .filter((f) => /^mongod.*\.exe$/i.test(f) || f === 'mongod')
      .sort((a, b) => (a.includes('7.0.14') ? -1 : b.includes('7.0.14') ? 1 : 0));

    if (binaries.length) return path.join(cache, binaries[0]);
  }

  const programFiles = [
    'C:\\Program Files\\MongoDB\\Server',
    'C:\\Program Files (x86)\\MongoDB\\Server',
  ];
  for (const base of programFiles) {
    if (!fs.existsSync(base)) continue;
    for (const version of fs.readdirSync(base).sort().reverse()) {
      const candidate = path.join(base, version, 'bin', 'mongod.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
};

const mongod = findMongod();

if (!mongod) {
  console.error(
    '❌ Could not find a mongod binary.\n' +
      '   Options:\n' +
      '     - run `npm test` once so mongodb-memory-server downloads a binary, then retry\n' +
      '     - install MongoDB Community Server\n' +
      '     - point MONGODB_BIN at a mongod executable\n' +
      '     - or set MONGODB_URI in backend/.env to a MongoDB Atlas cluster'
  );
  process.exit(1);
}

fs.mkdirSync(DB_PATH, { recursive: true });

const uri = `mongodb://127.0.0.1:${PORT}/${DB_NAME}`;
console.log(`🔧 Using mongod: ${mongod}`);
console.log(`📁 Data directory: ${DB_PATH}`);
console.log(`🔗 URI: ${uri}`);
console.log('   (put exactly this in backend/.env as MONGODB_URI)');
console.log('   Press Ctrl+C to stop.\n');

const child = spawn(
  mongod,
  [
    '--dbpath',
    DB_PATH,
    '--port',
    String(PORT),
    '--bind_ip',
    '127.0.0.1',
    '--quiet',
  ],
  { stdio: 'inherit' }
);

child.on('error', (err) => {
  console.error('❌ Failed to start mongod:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  if (code !== 0 && code !== null) console.error(`❌ mongod exited with code ${code}`);
  process.exit(code || 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill();
  });
}