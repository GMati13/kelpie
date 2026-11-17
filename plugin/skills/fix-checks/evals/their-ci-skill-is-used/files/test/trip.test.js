const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/TripPage.tsx', 'utf8');
if (!/<h1>Your trip<\/h1>/.test(src)) { console.error('FAIL: TripPage should render <h1>Your trip</h1>'); process.exit(1); }
console.log('ok');
