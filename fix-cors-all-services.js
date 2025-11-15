#!/usr/bin/env node
/**
 * Script to fix CORS configuration in all microservices
 * Usage: node fix-cors-all-services.js
 */

const fs = require('fs');
const path = require('path');

const SERVICES = [
  'room-service',
  'appointment-service',
  'payment-service',
  'invoice-service',
  'medicine-service',
  'record-service',
  'schedule-service',
  'service-service',
  'statistic-service',
  'chatbot-service'
];

const CORS_CONFIG = `app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:5173',
      'http://localhost:3000'
    ].filter(Boolean);
    
    // Check if origin is in comma-separated env var
    if (allowedOrigins.some(allowed => allowed.split(',').includes(origin))) {
      callback(null, true);
    } else if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));`;

function findCorsLine(content) {
  const lines = content.split('\n');
  let corsStartLine = -1;
  let corsEndLine = -1;
  let indentLevel = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Find app.use(cors({
    if (line.includes('app.use(cors(') && !line.includes('//')) {
      corsStartLine = i;
      indentLevel = line.search(/\S/); // Get indentation
      
      // Find closing }));
      let braceCount = 0;
      for (let j = i; j < lines.length; j++) {
        const checkLine = lines[j];
        braceCount += (checkLine.match(/\{/g) || []).length;
        braceCount -= (checkLine.match(/\}/g) || []).length;
        
        if (braceCount === 0 && checkLine.includes('})) ')) {
          corsEndLine = j;
          break;
        }
      }
      break;
    }
  }
  
  return { corsStartLine, corsEndLine, indentLevel };
}

function fixServiceCors(serviceName) {
  const indexPath = path.join(__dirname, 'services', serviceName, 'src', 'index.js');
  
  if (!fs.existsSync(indexPath)) {
    console.log(`⚠️  ${serviceName}: index.js not found`);
    return false;
  }
  
  let content = fs.readFileSync(indexPath, 'utf8');
  
  // Check if already has multi-origin CORS
  if (content.includes('origin: function(origin, callback)')) {
    console.log(`✅ ${serviceName}: Already has multi-origin CORS`);
    return false;
  }
  
  const { corsStartLine, corsEndLine, indentLevel } = findCorsLine(content);
  
  if (corsStartLine === -1) {
    console.log(`⚠️  ${serviceName}: CORS config not found`);
    return false;
  }
  
  const lines = content.split('\n');
  const indent = ' '.repeat(indentLevel);
  
  // Generate indented CORS config
  const indentedCorsConfig = CORS_CONFIG.split('\n').map(line => indent + line).join('\n');
  
  // Replace old CORS with new
  const before = lines.slice(0, corsStartLine);
  const after = lines.slice(corsEndLine + 1);
  const newContent = [...before, indentedCorsConfig, ...after].join('\n');
  
  // Backup original
  fs.writeFileSync(indexPath + '.backup', content);
  
  // Write new content
  fs.writeFileSync(indexPath, newContent);
  
  console.log(`✅ ${serviceName}: CORS fixed! (backup: index.js.backup)`);
  return true;
}

console.log('🔧 Fixing CORS in all microservices...\n');

let fixedCount = 0;
SERVICES.forEach(service => {
  if (fixServiceCors(service)) {
    fixedCount++;
  }
});

console.log(`\n✅ Fixed ${fixedCount}/${SERVICES.length} services`);
console.log('\n📝 Next steps:');
console.log('1. Review changes: git diff');
console.log('2. Test locally if needed');
console.log('3. Commit and push: git add . && git commit -m "fix: Add multi-origin CORS to all services" && git push');
console.log('4. CI/CD will auto-deploy to VPS');
