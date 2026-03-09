#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execFileSync, spawnSync } = require('child_process');

// ─── Paths ──────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const ENV_LOCAL = path.join(ROOT, '.env.local');
const SCHEMA_SQL = path.join(ROOT, 'db', 'schema.sql');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const BACKEND_DIR = path.join(ROOT, 'backend');
const WORKING_DIR = path.join(ROOT, 'working');
const BIN_DIR = process.platform === 'win32' ? 'Scripts' : 'bin';

// ─── Brand Colors (ANSI True Color) ────────────────────────────────
const C = {
  green:  (s) => `\x1b[38;2;200;255;0m${s}\x1b[0m`,
  orange: (s) => `\x1b[38;2;255;107;53m${s}\x1b[0m`,
  teal:   (s) => `\x1b[38;2;0;212;170m${s}\x1b[0m`,
  white:  (s) => `\x1b[38;2;245;245;240m${s}\x1b[0m`,
  gray:   (s) => `\x1b[38;2;160;160;144m${s}\x1b[0m`,
  red:    (s) => `\x1b[38;2;255;59;48m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[22m`,
  dim:    (s) => `\x1b[2m${s}\x1b[22m`,
  check:  '\x1b[38;2;200;255;0m\u2713\x1b[0m',
  cross:  '\x1b[38;2;255;59;48m\u2717\x1b[0m',
  arrow:  '\x1b[38;2;255;107;53m\u25B6\x1b[0m',
  dot:    '\x1b[38;2;0;212;170m\u2022\x1b[0m',
};

// ─── ASCII Art Header ───────────────────────────────────────────────
function printHeader() {
  const art = [
    ' \x1b[38;2;200;255;0m\x1b[1m ██████╗██╗     ██╗   ██╗██████╗ ███████╗\x1b[0m',
    ' \x1b[38;2;200;255;0m\x1b[1m██╔════╝██║     ╚██╗ ██╔╝██╔══██╗██╔════╝\x1b[0m',
    ' \x1b[38;2;200;255;0m\x1b[1m██║     ██║      ╚████╔╝ ██║  ██║█████╗  \x1b[0m',
    ' \x1b[38;2;200;255;0m\x1b[1m██║     ██║       ╚██╔╝  ██║  ██║██╔══╝  \x1b[0m',
    ' \x1b[38;2;200;255;0m\x1b[1m╚██████╗███████╗   ██║   ██████╔╝███████╗\x1b[0m',
    ' \x1b[38;2;200;255;0m\x1b[1m ╚═════╝╚══════╝   ╚═╝   ╚═════╝ ╚══════╝\x1b[0m',
  ];

  console.log('');
  art.forEach(line => console.log(line));
  console.log('');
  console.log(C.orange('  Multi-Agent AI Orchestration System'));
  console.log(C.gray('  ──────────────────────────────────────────'));
  console.log('');
}

// ─── Spinner ────────────────────────────────────────────────────────
function createSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${C.teal(frames[i++ % frames.length])} ${C.white(message)}`);
  }, 80);

  return {
    succeed(msg) {
      clearInterval(interval);
      process.stdout.write(`\r  ${C.check} ${C.white(msg || message)}                    \n`);
    },
    fail(msg) {
      clearInterval(interval);
      process.stdout.write(`\r  ${C.cross} ${C.red(msg || message)}                    \n`);
    },
  };
}

// ─── Prompt Utilities ───────────────────────────────────────────────
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${C.arrow} ${C.white(question)} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(`  ${C.arrow} ${C.white(question)} `);
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', (answer) => { rl.close(); resolve(answer.trim()); });
      return;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let input = '';
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (ch === '\u007f' || ch === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (ch === '\u0003') {
        console.log('');
        process.exit(1);
      } else {
        input += ch;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

async function promptWithValidation(question, validate, errorMsg, { secret = false } = {}) {
  while (true) {
    const value = secret ? await promptSecret(question) : await prompt(question);
    if (validate(value)) return value;
    console.log(`  ${C.cross} ${C.red(errorMsg)}`);
  }
}

// ─── Shell helpers (safe, no injection) ─────────────────────────────
function npmInstall(cwd) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawnSync(npm, ['install'], { cwd, stdio: 'pipe', timeout: 120000 });
}

function npmRunDev(cwd, env) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(npm, ['run', 'dev'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

// ─── Env File Utilities ─────────────────────────────────────────────
function loadEnvFile() {
  if (!fs.existsSync(ENV_LOCAL)) return {};
  const content = fs.readFileSync(ENV_LOCAL, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
  }
  return env;
}

function writeEnvFile(config) {
  const lines = [
    '# Anthropic',
    `ANTHROPIC_API_KEY=${config.ANTHROPIC_API_KEY}`,
    '',
    '# Supabase',
    `NEXT_PUBLIC_SUPABASE_URL=${config.NEXT_PUBLIC_SUPABASE_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${config.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${config.SUPABASE_SERVICE_ROLE_KEY}`,
    '',
    '# OpenAI (embeddings)',
    `OPENAI_API_KEY=${config.OPENAI_API_KEY}`,
    '',
    '# Backend',
    `BACKEND_URL=${config.BACKEND_URL}`,
    `NEXT_PUBLIC_BACKEND_WS_URL=${config.NEXT_PUBLIC_BACKEND_WS_URL}`,
    '',
    '# Working directory (absolute path)',
    `WORKING_DIR=${config.WORKING_DIR}`,
    '',
  ];
  fs.writeFileSync(ENV_LOCAL, lines.join('\n'));
}

// ─── First-Run Detection ────────────────────────────────────────────
function isFirstRun() {
  if (!fs.existsSync(ENV_LOCAL)) return true;

  const content = fs.readFileSync(ENV_LOCAL, 'utf8');
  const placeholders = ['sk-ant-...', 'your-project.supabase.co', 'eyJ...', 'sk-proj-...', '/path/to/'];
  const required = [
    'ANTHROPIC_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
  ];

  for (const key of required) {
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    if (!match) return true;
    const value = match[1].trim();
    if (!value || placeholders.some(p => value.includes(p))) return true;
  }
  return false;
}

// ─── Prerequisites Check ────────────────────────────────────────────
function checkPrerequisites() {
  console.log(C.bold(C.white('  Checking prerequisites...\n')));
  let allGood = true;

  // Node.js
  const nodeMajor = parseInt(process.versions.node.split('.')[0]);
  if (nodeMajor >= 20) {
    console.log(`  ${C.check} ${C.white(`Node.js ${process.versions.node}`)}`);
  } else {
    console.log(`  ${C.cross} ${C.white(`Node.js ${process.versions.node}`)} ${C.red('(need 20+)')}`);
    allGood = false;
  }

  // Python
  try {
    const result = spawnSync('python3', ['--version'], { encoding: 'utf8' });
    const pyVersion = (result.stdout || result.stderr || '').trim();
    const pyMatch = pyVersion.match(/(\d+)\.(\d+)/);
    if (pyMatch && parseInt(pyMatch[1]) === 3 && parseInt(pyMatch[2]) >= 10) {
      console.log(`  ${C.check} ${C.white(pyVersion)}`);
    } else {
      console.log(`  ${C.cross} ${C.white(pyVersion)} ${C.red('(need 3.10+)')}`);
      allGood = false;
    }
  } catch {
    console.log(`  ${C.cross} ${C.red('Python 3 not found')}`);
    allGood = false;
  }

  // Git
  try {
    const result = spawnSync('git', ['--version'], { encoding: 'utf8' });
    const gitVersion = (result.stdout || '').trim();
    console.log(`  ${C.check} ${C.white(gitVersion)}`);
  } catch {
    console.log(`  ${C.cross} ${C.red('Git not found')}`);
    allGood = false;
  }

  console.log('');
  if (!allGood) {
    console.log(C.red('  Please install the missing prerequisites and try again.\n'));
    process.exit(1);
  }
}

// ─── Setup Wizard ───────────────────────────────────────────────────
async function runSetupWizard() {
  console.log(C.bold(C.green('  FIRST-TIME SETUP\n')));
  console.log(C.gray('  You\'ll need your Supabase dashboard and API keys ready.'));
  console.log(C.gray('  Credentials are stored locally in .env.local and never shared.\n'));

  // Supabase
  console.log(C.bold(C.orange('  Supabase')) + C.gray('  (Dashboard > Settings > API)'));
  console.log('');

  const supabaseUrl = await promptWithValidation(
    'Project URL:',
    (v) => /^https?:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(v),
    'Expected format: https://<ref>.supabase.co'
  );

  const supabaseAnonKey = await promptWithValidation(
    'Anon Key:',
    (v) => v.startsWith('eyJ') && v.length > 30,
    'Anon key should start with "eyJ"',
    { secret: true }
  );

  const supabaseServiceKey = await promptWithValidation(
    'Service Role Key:',
    (v) => v.startsWith('eyJ') && v.length > 30,
    'Service role key should start with "eyJ"',
    { secret: true }
  );

  console.log('');
  console.log(C.bold(C.orange('  Database')) + C.gray('  (password set when you created the project)'));
  console.log('');

  const dbPassword = await promptSecret('Database Password:');

  console.log('');
  console.log(C.bold(C.orange('  API Keys')) + C.gray('  (console.anthropic.com | platform.openai.com)'));
  console.log('');

  const anthropicKey = await promptWithValidation(
    'Anthropic API Key:',
    (v) => v.startsWith('sk-ant-') && v.length > 20,
    'Key should start with "sk-ant-"',
    { secret: true }
  );

  const openaiKey = await promptWithValidation(
    'OpenAI API Key:',
    (v) => v.startsWith('sk-') && v.length > 20,
    'Key should start with "sk-"',
    { secret: true }
  );

  // Extract project ref
  const refMatch = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
  const projectRef = refMatch[1];

  const config = {
    ANTHROPIC_API_KEY: anthropicKey,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl.replace(/\/$/, ''),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabaseServiceKey,
    OPENAI_API_KEY: openaiKey,
    BACKEND_URL: 'http://localhost:8000',
    NEXT_PUBLIC_BACKEND_WS_URL: 'ws://localhost:8000',
    WORKING_DIR: WORKING_DIR,
  };

  return { config, projectRef, dbPassword };
}

// ─── Schema Deployment ──────────────────────────────────────────────
async function deploySchema(projectRef, dbPassword) {
  const spinner = createSpinner('Deploying database schema...');

  // Ensure pg is available
  let pg;
  try {
    pg = require('pg');
  } catch {
    spinner.succeed('');
    const installSpinner = createSpinner('Installing pg driver...');
    const result = npmInstall(ROOT);
    if (result.status !== 0) {
      installSpinner.fail('Failed to install pg driver');
      process.exit(1);
    }
    installSpinner.succeed('pg driver installed');
    pg = require('pg');
    return deploySchemaWithPg(pg, projectRef, dbPassword);
  }

  return deploySchemaWithPg(pg, projectRef, dbPassword);
}

async function deploySchemaWithPg(pg, projectRef, dbPassword) {
  const spinner = createSpinner('Deploying database schema...');
  try {
    const client = new pg.Client({
      host: `db.${projectRef}.supabase.co`,
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: dbPassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });

    await client.connect();

    const schema = fs.readFileSync(SCHEMA_SQL, 'utf8');
    await client.query(schema);
    await client.end();

    spinner.succeed('Database schema deployed (8 tables, 1 function, 7 indexes)');
  } catch (err) {
    spinner.fail('Database schema deployment failed');

    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.log(C.red(`\n  Could not connect to db.${projectRef}.supabase.co`));
      console.log(C.gray('  Check your Supabase URL and ensure the project is active.\n'));
    } else if (err.message && err.message.includes('password authentication failed')) {
      console.log(C.red('\n  Database password is incorrect.'));
      console.log(C.gray('  Reset it in Supabase Dashboard > Settings > Database.\n'));
    } else if (err.message && err.message.includes('already exists')) {
      console.log(C.gray('  Schema already exists — skipping.\n'));
      return;
    } else {
      console.log(C.red(`\n  ${err.message}\n`));
    }

    const answer = await prompt('Continue without schema deployment? (y/n):');
    if (answer.toLowerCase() !== 'y') process.exit(1);
  }
}

// ─── Dependency Installation ────────────────────────────────────────
async function installDependencies() {
  console.log('');
  console.log(C.bold(C.white('  Installing dependencies...\n')));

  // Root (pg)
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'pg'))) {
    const spinner = createSpinner('Installing root dependencies...');
    const result = npmInstall(ROOT);
    if (result.status !== 0) {
      spinner.fail('Root dependency install failed');
      console.log(C.red(`  ${(result.stderr || '').toString()}`));
      process.exit(1);
    }
    spinner.succeed('Root dependencies installed');
  } else {
    console.log(`  ${C.check} ${C.white('Root dependencies already installed')}`);
  }

  // Frontend
  if (!fs.existsSync(path.join(FRONTEND_DIR, 'node_modules'))) {
    const spinner = createSpinner('Installing frontend dependencies...');
    const result = npmInstall(FRONTEND_DIR);
    if (result.status !== 0) {
      spinner.fail('Frontend install failed');
      console.log(C.red(`  ${(result.stderr || '').toString()}`));
      process.exit(1);
    }
    spinner.succeed('Frontend dependencies installed');
  } else {
    console.log(`  ${C.check} ${C.white('Frontend dependencies already installed')}`);
  }

  // Backend venv
  const venvPath = path.join(BACKEND_DIR, '.venv');
  if (!fs.existsSync(venvPath)) {
    const spinner = createSpinner('Creating Python virtual environment...');
    const result = spawnSync('python3', ['-m', 'venv', '.venv'], {
      cwd: BACKEND_DIR,
      stdio: 'pipe',
    });
    if (result.status !== 0) {
      spinner.fail('Venv creation failed');
      console.log(C.red(`  ${(result.stderr || '').toString()}`));
      process.exit(1);
    }
    spinner.succeed('Python virtual environment created');
  }

  // Python requirements
  const pip = path.join(venvPath, BIN_DIR, 'pip');
  const spinner = createSpinner('Installing Python dependencies...');
  const pipResult = spawnSync(pip, ['install', '-r', 'requirements.txt'], {
    cwd: BACKEND_DIR,
    stdio: 'pipe',
    timeout: 180000,
  });
  if (pipResult.status !== 0) {
    spinner.fail('Python dependency install failed');
    console.log(C.red(`  ${(pipResult.stderr || '').toString()}`));
    process.exit(1);
  }
  spinner.succeed('Python dependencies installed');
}

// ─── Working Directory Setup ────────────────────────────────────────
function ensureWorkingDir() {
  const dirs = ['agents', 'prompts', 'memory', 'logs', 'output', 'skills', 'uploads', 'teams', 'workflows'];
  for (const dir of dirs) {
    const p = path.join(WORKING_DIR, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

// ─── App Launcher ───────────────────────────────────────────────────
function launchApp() {
  console.log(C.bold(C.green('  STARTING CLYDE\n')));

  const env = { ...process.env, ...loadEnvFile() };
  const children = [];
  let browserOpened = false;

  // Backend
  const uvicorn = path.join(BACKEND_DIR, '.venv', BIN_DIR, 'uvicorn');
  const backend = spawn(uvicorn, [
    'main:app', '--reload', '--host', '127.0.0.1', '--port', '8000',
  ], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(backend);

  const formatLine = (prefix, colorFn, line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.includes('ERROR') || trimmed.includes('Traceback')) {
      console.log(`  ${colorFn(prefix)} ${C.red(trimmed)}`);
    } else {
      console.log(`  ${colorFn(prefix)} ${C.gray(trimmed)}`);
    }
  };

  backend.stdout.on('data', (data) => {
    data.toString().split('\n').forEach(l => formatLine('[backend] ', C.teal, l));
  });
  backend.stderr.on('data', (data) => {
    data.toString().split('\n').forEach(l => formatLine('[backend] ', C.teal, l));
  });

  // Frontend
  const frontend = npmRunDev(FRONTEND_DIR, env);
  children.push(frontend);

  frontend.stdout.on('data', (data) => {
    const text = data.toString();
    text.split('\n').forEach(l => formatLine('[frontend]', C.green, l));

    if (!browserOpened && (text.includes('Ready') || text.includes('localhost:3020'))) {
      browserOpened = true;
      setTimeout(() => {
        const cmd = process.platform === 'darwin' ? 'open'
          : process.platform === 'win32' ? 'start'
          : 'xdg-open';
        try {
          execFileSync(cmd, ['http://localhost:3020'], { stdio: 'ignore' });
          console.log(`\n  ${C.check} ${C.white('Opened')} ${C.green('http://localhost:3020')} ${C.white('in your browser')}\n`);
        } catch { /* best-effort */ }
      }, 1500);
    }
  });
  frontend.stderr.on('data', (data) => {
    data.toString().split('\n').forEach(l => formatLine('[frontend]', C.green, l));
  });

  // Status line
  console.log(`  ${C.dot} ${C.teal('Backend')}  ${C.gray('\u2192')} ${C.white('http://127.0.0.1:8000')}`);
  console.log(`  ${C.dot} ${C.green('Frontend')} ${C.gray('\u2192')} ${C.white('http://localhost:3020')}`);
  console.log('');
  console.log(C.gray('  Press Ctrl+C to stop\n'));

  // Graceful shutdown
  const shutdown = () => {
    console.log(`\n  ${C.orange('Shutting down...')}`);
    children.forEach(child => { if (!child.killed) child.kill('SIGTERM'); });
    setTimeout(() => {
      children.forEach(child => { if (!child.killed) child.kill('SIGKILL'); });
      process.exit(0);
    }, 3000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  backend.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`\n  ${C.cross} ${C.red(`Backend exited with code ${code}`)}`);
    }
  });

  frontend.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`\n  ${C.cross} ${C.red(`Frontend exited with code ${code}`)}`);
    }
  });
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  printHeader();

  if (isFirstRun()) {
    checkPrerequisites();

    const { config, projectRef, dbPassword } = await runSetupWizard();

    // Write .env.local
    console.log('');
    const envSpinner = createSpinner('Writing .env.local...');
    writeEnvFile(config);
    envSpinner.succeed('.env.local created');

    // Deploy schema
    await deploySchema(projectRef, dbPassword);

    // Install dependencies
    await installDependencies();

    // Ensure working directory
    ensureWorkingDir();

    // Done
    console.log('');
    console.log(C.green('  ──────────────────────────────────────────'));
    console.log(C.bold(C.green('  SETUP COMPLETE')));
    console.log(C.green('  ──────────────────────────────────────────'));
    console.log('');
  } else {
    ensureWorkingDir();
    console.log(`  ${C.check} ${C.white('Configuration detected')}`);
    console.log('');
  }

  launchApp();
}

main().catch((err) => {
  console.error(C.red(`\n  Fatal error: ${err.message}\n`));
  process.exit(1);
});
