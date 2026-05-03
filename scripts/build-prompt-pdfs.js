// Generates PDF copies of the inbound and outbound system prompt templates
// for easy download from the repo. Reads the template strings directly from
// src/agent/prompts.ts so the PDFs always reflect the live source.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const SRC = path.join(__dirname, '..', 'src', 'agent', 'prompts.ts');
const OUT_DIR = path.join(__dirname, '..', 'docs', 'prompts');

const STUB_LEAD = {
  first_name: '${lead.first_name}',
  state: '${lead.state}',
  current_insurer: '${lead.current_insurer}',
  vehicles: [{ year: '${year}', make: '${make}', model: '${model}' }],
};

function loadPrompts() {
  // Compile the .ts via a tiny on-the-fly transpile: strip type annotations.
  // Easier: just import the compiled module via ts-node? Not installed.
  // Simplest reliable path: extract the template literal bodies with regex.
  const src = fs.readFileSync(SRC, 'utf8');

  function extractFn(name) {
    const re = new RegExp(`export function ${name}\\b[\\s\\S]*?return \`([\\s\\S]*?)\`;\\s*\\n\\}`, 'm');
    const m = src.match(re);
    if (!m) throw new Error(`Could not extract ${name}`);
    return m[1];
  }

  const outboundTpl = extractFn('buildSystemPrompt');
  const inboundTpl = extractFn('buildInboundSystemPrompt');

  // Substitute the placeholders we know about with readable defaults.
  const outbound = outboundTpl
    .replace(/\$\{agentName\}/g, 'Steve')
    .replace(/\$\{companyName\}/g, 'Smart Quotes')
    .replace(/\$\{lead\.first_name\}/g, '{first_name}')
    .replace(/\$\{lead\.state \|\| 'unknown'\}/g, '{state}')
    .replace(/\$\{safeCurrentInsurer \|\| 'not provided'\}/g, '{current_insurer}')
    .replace(/\$\{vehicleRef \? `\\nVehicle: \$\{vehicleRef\}` : ''\}/g, '\nVehicle: {vehicle}')
    .replace(/\$\{allVehiclesStr && allVehiclesStr !== vehicleRef \? `\\nAll vehicles: \$\{allVehiclesStr\}` : ''\}/g, '')
    .replace(/\$\{vehicleRef \|\| 'vehicle on file'\}/g, '{vehicle}')
    .replace(/\$\{vehicleRef\}/g, '{vehicle}');

  const inbound = inboundTpl
    .replace(/\$\{agentName\}/g, 'Steve')
    .replace(/\$\{companyName\}/g, 'Quoting Fast')
    .replace(/\$\{callerNumber\}/g, '{caller_phone_number}');

  return { outbound, inbound };
}

function writePdf(filePath, title, body) {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: { Title: title, Author: 'AiOutboundAgent' },
  });

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(title, { align: 'left' });
  doc.moveDown(0.3);
  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .fillColor('#666')
    .text(`Source: src/agent/prompts.ts  •  Generated: ${new Date().toISOString()}`);
  doc.moveDown(0.8);
  doc.fillColor('#000');

  doc.font('Courier').fontSize(9).text(body, {
    lineGap: 1.5,
    align: 'left',
  });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { outbound, inbound } = loadPrompts();

  await writePdf(
    path.join(OUT_DIR, 'outbound-system-prompt.pdf'),
    'Outbound System Prompt',
    outbound,
  );
  await writePdf(
    path.join(OUT_DIR, 'inbound-system-prompt.pdf'),
    'Inbound System Prompt',
    inbound,
  );

  console.log('Wrote PDFs to', OUT_DIR);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
