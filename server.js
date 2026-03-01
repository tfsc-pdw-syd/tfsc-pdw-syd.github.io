require('dotenv').config();

const express  = require('express');
const multer   = require('multer');
const nodemailer = require('nodemailer');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── File upload (memory, 20 MB, PDF / Word only) ────────────────────────────
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

// ── Email transporter (Gmail + App Password) ────────────────────────────────
function makeTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

// ── POST /submit ─────────────────────────────────────────────────────────────
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

    const transporter = makeTransporter();
    const recipient   = process.env.RECIPIENT_EMAIL || 'mengjia.wu@uts.edu.au';

    // Forward submission to organiser
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

    // Acknowledgement to submitter
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

// ── Fallback: serve index.html for any other GET ─────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TFSC PDW server listening on port ${PORT}`);
});
