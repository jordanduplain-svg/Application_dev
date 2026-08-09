// Récepteur ponctuel : reçoit un JPEG en base64 par POST et l'écrit sur disque.
// Usage : node scripts/shot-server.mjs <fichier-sortie>
import http from 'node:http';
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    writeFileSync(out, Buffer.from(body, 'base64'));
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    res.end('ok');
    console.log(`écrit ${out} (${body.length} chars b64)`);
    server.close();
  });
});
server.listen(8123, () => console.log('en écoute sur 8123'));
setTimeout(() => { console.error('timeout'); server.close(); }, 60000);
