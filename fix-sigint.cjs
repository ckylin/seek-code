const fs = require('fs');
let c = fs.readFileSync('src/cli/repl.ts', 'utf8');

const old = "process.on('SIGINT', () => {\r\n    process.stdout.write(chalk.yellow('\\nInterrupted.\\n'));\r\n    process.exit(0);\r\n  });";
const rep = "process.on('SIGINT', () => {\r\n    if (getActiveInterruptCount() > 0) return;\r\n    process.stdout.write(chalk.yellow('\\nInterrupted.\\n'));\r\n    process.exit(0);\r\n  });";

if (c.includes(old)) {
  c = c.replace(old, rep);
  fs.writeFileSync('src/cli/repl.ts', c);
  process.stdout.write('done\n');
} else {
  process.stdout.write('not found\n');
}
