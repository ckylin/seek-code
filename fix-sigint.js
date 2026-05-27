const fs = require('fs');
let c = fs.readFileSync('src/cli/repl.ts', 'utf8');
const idx = c.indexOf("process.on('SIGINT'");
console.log('Index:', idx);
console.log('Content:', JSON.stringify(c.substring(idx, idx + 200)));
