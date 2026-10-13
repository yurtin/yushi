// Find where usage lives in a DSH v4 transcript record.
import fs from 'node:fs';
const f = process.argv[2];
const text = fs.readFileSync(f, 'utf8');
for (const line of text.split('\n')) {
  if (!line.includes('"usage"')) continue;
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }
  const d = rec.data || {};
  console.log('type:', rec.type);
  console.log('data keys:', Object.keys(d).join(','));
  const usage = d.usage || (d.message && d.message.usage);
  console.log('usage found at:', d.usage ? 'data.usage' : (d.message && d.message.usage ? 'data.message.usage' : 'NOT FOUND'));
  if (usage) console.log(JSON.stringify(usage));
  else {
    // deep search for the key
    const stack = [[d, 'data']];
    while (stack.length) {
      const [o, p] = stack.pop();
      if (!o || typeof o !== 'object') continue;
      for (const k of Object.keys(o)) {
        if (k === 'usage') console.log('usage at', p + '.' + k, JSON.stringify(o[k]).slice(0, 400));
        else if (o[k] && typeof o[k] === 'object' && p.split('.').length < 5) stack.push([o[k], p + '.' + k]);
      }
    }
  }
  break;
}
