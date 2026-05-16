const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commandShell = process.env.ComSpec || 'cmd.exe';

const mongoUser = 'admin';
const mongoPassword = 'password123';
const mongoHost = 'localhost';
const mongoPort = '27017';
const rabbitUser = 'guest';
const rabbitPassword = 'guest';

const mongoUri = (databaseName) =>
  `mongodb://${mongoUser}:${mongoPassword}@${mongoHost}:${mongoPort}/${databaseName}?authSource=admin`;

const commonEnv = {
  NODE_ENV: 'development',
  FRONTEND_URL: 'http://localhost:5173',
  CORS_ORIGIN: 'http://localhost:5173',
  SOCKET_CORS_ORIGINS: 'http://localhost:5173',
  REDIS_URL: 'redis://localhost:6379',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: '',
  RABBITMQ_URL: `amqp://${rabbitUser}:${rabbitPassword}@localhost:5672`,
  JWT_SECRET: 'your_jwt_secret_key_here',
  ACCESS_TOKEN_SECRET: 'your_access_token_secret_here',
  REFRESH_TOKEN_SECRET: 'your_refresh_token_secret_here',
  VNPAY_RETURN_URL: 'http://localhost:3007/api/payments/return/vnpay',
  STRIPE_RETURN_URL: 'http://localhost:3007/api/payments/return/stripe',
  STRIPE_EXCHANGE_RATE: '25000',
};

const serviceDefaults = [
  ['auth-service', 3001, 'dental_clinic_auth'],
  ['room-service', 3002, 'dental_clinic_room'],
  ['service-service', 3003, 'dental_clinic_service'],
  ['schedule-service', 3005, 'dental_clinic_schedule'],
  ['appointment-service', 3006, 'dental_clinic_appointment'],
  ['payment-service', 3007, 'dental_clinic_payment'],
  ['invoice-service', 3008, 'dental_clinic_invoice'],
  ['medicine-service', 3009, 'dental_clinic_medicine'],
  ['record-service', 3010, 'dental_clinic_record'],
  ['statistic-service', 3011, 'dental_clinic_statistic'],
  ['chatbot-service', 3013, 'dental_clinic_chatbot'],
];

const services = serviceDefaults.map(([name, port, databaseName]) => ({
  name,
  port: String(port),
  cwd: path.join(rootDir, 'services', name),
  databaseName,
}));

function getScriptName(serviceDir) {
  const packageJsonPath = path.join(serviceDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.scripts?.dev ? 'dev' : 'start';
}

function prefixOutput(serviceName, stream, data) {
  data
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => stream.write(`[${serviceName}] ${line}\n`));
}

function buildServiceEnv(serviceEnv) {
  return Object.fromEntries(
    Object.entries(serviceEnv)
      .filter(([key, value]) => key && !key.startsWith('=') && value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
}

function buildSpawnCommand(scriptName) {
  if (process.platform === 'win32') {
    return {
      command: commandShell,
      args: ['/d', '/s', '/c', `${npmCommand} run ${scriptName}`],
    };
  }

  return {
    command: npmCommand,
    args: ['run', scriptName],
  };
}

function runNpmCommand(args, options) {
  if (process.platform === 'win32') {
    return spawnSync(commandShell, ['/d', '/s', '/c', `${npmCommand} ${args.join(' ')}`], options);
  }

  return spawnSync(npmCommand, args, options);
}

function ensureDependencies(service) {
  const nodeModulesPath = path.join(service.cwd, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    return;
  }

  console.log(`[dev:all] Installing dependencies for ${service.name}...`);
  const result = runNpmCommand(['install'], {
    cwd: service.cwd,
    env: buildServiceEnv(process.env),
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to install dependencies for ${service.name}`);
  }
}

services.forEach(ensureDependencies);

const children = services.map((service) => {
  const scriptName = getScriptName(service.cwd);
  const serviceEnv = {
    ...process.env,
    ...commonEnv,
    PORT: service.port,
    MONGODB_URI: mongoUri(service.databaseName),
    MONGO_URI: mongoUri(service.databaseName),
  };

  if (service.name === 'chatbot-service') {
    Object.assign(serviceEnv, {
      AUTH_DB_URI: mongoUri('dental_clinic_auth'),
      SERVICE_DB_URI: mongoUri('dental_clinic_service'),
      SCHEDULE_DB_URI: mongoUri('dental_clinic_schedule'),
      ROOM_DB_URI: mongoUri('dental_clinic_room'),
    });
  }

  const { command, args } = buildSpawnCommand(scriptName);
  const child = spawn(command, args, {
    cwd: service.cwd,
    env: buildServiceEnv(serviceEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (data) => prefixOutput(service.name, process.stdout, data));
  child.stderr.on('data', (data) => prefixOutput(service.name, process.stderr, data));
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[${service.name}] exited with code ${code}`);
    }
  });

  console.log(`[dev:all] ${service.name} -> npm run ${scriptName} on port ${service.port}`);
  return child;
});

function shutdown() {
  console.log('\n[dev:all] Stopping services...');
  children.forEach((child) => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
