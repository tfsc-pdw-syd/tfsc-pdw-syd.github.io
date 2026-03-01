require('dotenv').config();

const express    = require('express');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── Submissions storage ───────────────────────────────────────────────────────
// On Render: set SUBMISSIONS_DIR to your Disk mount path (e.g. /data/submissions)
// Locally:   defaults to ./submissions
const SUBMISSIONS_DIR = process.env.SUBMISSIONS_DIR || path.join(__dirname, 'submissions');
const FILES_DIR       = path.join(SUBMISSIONS_DIR, 'files');
const LOG_PATH        = path.join(SUBMISSIONS_DIR, 'submissions.jsonl');

fs.mkdirSync(FILES_DIR, { recursive: true });

// ── File upload (memory, 20 MB, PDF / Word only) ──────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (/\.(pdf|doc|docx)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Word files (.pdf, .doc, .docx) are accepted.'));
    }
  }
});

// ── Email transporter (Gmail + App Password) ──────────────────────────────────
function makeTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

// ── Admin auth middleware ─────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.query.token !== token) {
    return res.status(401).send('Unauthorized. Append ?token=YOUR_ADMIN_TOKEN to the URL.');
  }
  next();
}

// ── POST /submit ──────────────────────────────────────────────────────────────
app.post('/submit', upload.single('manuscript'), async (req, res) => {
  try {
    const { title, submitter_email, authors: authorsJSON } = req.body;

    if (!title || !submitter_email || !authorsJSON || !req.file) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const authors = JSON.parse(authorsJSON);
    if (!Array.isArray(authors) || authors.length === 0) {
      return res.status(400).json({ error: 'At least one author is required.' });
    }

    const authorsText = authors
      .map((a, i) => {
        let line = `${i + 1}. ${a.name} — ${a.affiliation}`;
        if (a.orcid) line += ` (ORCID: ${a.orcid})`;
        return line;
      })
      .join('\n');

    // ── Save file to disk ───────────────────────────────────────────────────
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext       = path.extname(req.file.originalname);
    const savedName = `${timestamp}${ext}`;
    fs.writeFileSync(path.join(FILES_DIR, savedName), req.file.buffer);

    // ── Append submission record ────────────────────────────────────────────
    const record = {
      submittedAt:     new Date().toISOString(),
      title,
      authors,
      submitter_email,
      originalFilename: req.file.originalname,
      savedFilename:    savedName
    };
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');

    // ── Send emails ─────────────────────────────────────────────────────────
    const transporter = makeTransporter();
    const recipient   = process.env.RECIPIENT_EMAIL || 'mengjia.wu@uts.edu.au';

    await transporter.sendMail({
      from:    `"TFSC PDW Submissions" <${process.env.EMAIL_USER}>`,
      to:      recipient,
      replyTo: submitter_email,
      subject: `[PDW Submission] ${title}`,
      text: [
        'A new abstract has been submitted to the TFSC Special Issue PDW 2026.',
        '',
        `Title: ${title}`,
        '',
        'Authors:',
        authorsText,
        '',
        `Submitter email: ${submitter_email}`
      ].join('\n'),
      attachments: [{
        filename: req.file.originalname,
        content:  req.file.buffer
      }]
    });

    await transporter.sendMail({
      from:    `"TFSC PDW 2026" <${process.env.EMAIL_USER}>`,
      to:      submitter_email,
      subject: 'Submission Received – TFSC Special Issue Paper Development Workshop 2026',
      text: [
        'Dear Author,',
        '',
        'Thank you for submitting to the TFSC Special Issue Paper Development Workshop 2026.',
        '',
        `We have received your abstract: "${title}"`,
        '',
        'You will be notified of the outcome by 20 May 2026.',
        '',
        'If you have any questions, please contact mengjia.wu@uts.edu.au.',
        '',
        'Best regards,',
        'TFSC PDW 2026 Organising Committee',
        'University of Technology Sydney'
      ].join('\n')
    });

    res.json({ success: true });

  } catch (err) {
    console.error('Submission error:', err.message);
    res.status(500).json({ error: err.message || 'Submission failed. Please try again.' });
  }
});

// ── GET /admin — submission dashboard ────────────────────────────────────────
app.get('/admin', requireAdmin, (req, res) => {
  const token = req.query.token;

  let records = [];
  if (fs.existsSync(LOG_PATH)) {
    records = fs.readFileSync(LOG_PATH, 'utf8')
      .trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line))
      .reverse(); // newest first
  }

  const rows = records.map((r, i) => {
    const authorsStr = r.authors.map(a => `${a.name} (${a.affiliation})`).join('<br>');
    const date       = new Date(r.submittedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
    return `
      <tr>
        <td>${records.length - i}</td>
        <td>${date}</td>
        <td>${escHtml(r.title)}</td>
        <td>${authorsStr}</td>
        <td>${escHtml(r.submitter_email)}</td>
        <td><a href="/admin/files/${encodeURIComponent(r.savedFilename)}?token=${token}" download="${escHtml(r.originalFilename)}">${escHtml(r.originalFilename)}</a></td>
      </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PDW Submissions – Admin</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; color: #333; }
    h1   { color: #8b0000; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
    th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; }
    a  { color: #8b0000; }
    .actions { margin-bottom: 1.5rem; }
    .actions a { margin-right: 1rem; padding: 8px 16px; background: #8b0000; color: #fff;
                 text-decoration: none; border-radius: 4px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>TFSC PDW 2026 — Submissions (${records.length})</h1>
  <div class="actions">
    <a href="/admin/submissions.csv?token=${token}">Download CSV</a>
    <a href="/admin/submissions.json?token=${token}">Download JSON</a>
  </div>
  ${records.length === 0
    ? '<p>No submissions yet.</p>'
    : `<table>
        <thead><tr><th>#</th><th>Date (AEST)</th><th>Title</th><th>Authors</th><th>Email</th><th>File</th></tr></thead>
        <tbody>${rows}</tbody>
       </table>`
  }
</body>
</html>`);
});

// ── GET /admin/submissions.csv ────────────────────────────────────────────────
app.get('/admin/submissions.csv', requireAdmin, (req, res) => {
  if (!fs.existsSync(LOG_PATH)) {
    return res.status(404).send('No submissions yet.');
  }
  const records = fs.readFileSync(LOG_PATH, 'utf8')
    .trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line));

  const header = ['#', 'Submitted At', 'Title', 'Authors', 'Affiliations', 'ORCIDs', 'Submitter Email', 'Filename'];
  const csvRows = records.map((r, i) => {
    const names   = r.authors.map(a => a.name).join(' | ');
    const affils  = r.authors.map(a => a.affiliation).join(' | ');
    const orcids  = r.authors.map(a => a.orcid || '').join(' | ');
    return [i + 1, r.submittedAt, r.title, names, affils, orcids, r.submitter_email, r.originalFilename]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',');
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="submissions.csv"');
  res.send([header.join(','), ...csvRows].join('\n'));
});

// ── GET /admin/submissions.json ───────────────────────────────────────────────
app.get('/admin/submissions.json', requireAdmin, (req, res) => {
  if (!fs.existsSync(LOG_PATH)) return res.json([]);
  const records = fs.readFileSync(LOG_PATH, 'utf8')
    .trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line));
  res.setHeader('Content-Disposition', 'attachment; filename="submissions.json"');
  res.json(records);
});

// ── GET /admin/files/:filename ────────────────────────────────────────────────
app.get('/admin/files/:filename', requireAdmin, (req, res) => {
  // path.basename prevents directory traversal
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(FILES_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found.');
  res.download(filePath);
});

// ── Fallback: serve index.html for any other GET ──────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TFSC PDW server listening on port ${PORT}`);
  console.log(`Submissions stored in: ${SUBMISSIONS_DIR}`);
});

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
