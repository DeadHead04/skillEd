// Actual deterministic custom engine: hash user input and write real workspace artifacts.
const fs = require('node:fs');
const crypto = require('node:crypto');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const prompt = input.messages.filter(m => m.role === 'user').at(-1)?.content || '';
const digest = crypto.createHash('sha256').update(prompt).digest('hex');
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync('results/digest.txt', digest);
const count = Number(input.session_id || 0) + 1;
console.log(JSON.stringify({ exit_code: 0, session_id: String(count), final_message: digest, transcript: [{ role: 'assistant', content: digest }], artifacts: { generated_files: ['results/digest.txt'] } }));
