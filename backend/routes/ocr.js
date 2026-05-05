const express = require("express");
const multer = require("multer");
const Tesseract = require("tesseract.js");
const Leads = require("../models/Leads");
const LeadContacts = require("../models/LeadContacts");

const router = express.Router();

// Store file in memory
const upload = multer({ storage: multer.memoryStorage() });

router.post("/scan-business-card", upload.single("card"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const result = await Tesseract.recognize(
      req.file.buffer,
      "eng"
    );
    const text = result.data.text;
    const parsed = parseBusinessCard(text);

    const newLead = await Leads.create({
      company_name: parsed.company_name,
      Address: parsed.address,
      website: parsed.website,
      status: "new",
      is_active: true
    });

    await LeadContacts.create({
      lead_id: newLead._id,
      name: parsed.name,
      designation: parsed.designation,
      phone: parsed.phone,
      email: parsed.email,
      address: parsed.address,
      is_primary: true
    });

    res.json({
      message: "Lead created from OCR",
      raw_text: text,
      parsed_data: parsed
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "OCR failed" });
  }
});

function parseBusinessCard(text) {
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const fullText = lines.join(" ");

  let name = "";
  let designation = "";
  let company_name = "";
  let email = "";
  let phone = "";
  let fax = "";
  let website = "";
  const addressParts = [];

  const emailMatch = fullText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (emailMatch) {
    email = emailMatch[0];
  }

  const websiteMatch = fullText.match(/(https?:\/\/)?(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/);
  if (websiteMatch) {
    website = websiteMatch[0];
    if (!website.startsWith("http")) {
      website = `http://${website}`;
    }
  }

  lines.forEach(line => {
    const numberMatch = line.match(/(\+?\d[\d\s-]{8,}\d)/);

    if (numberMatch) {
      if (line.toLowerCase().includes("fax")) {
        fax = numberMatch[0];
      } else if (line.toLowerCase().includes("office") || !phone) {
        phone = numberMatch[0];
      }
    }
  });

  const filteredLines = lines.filter(line => {
    const lower = line.toLowerCase();
    return (
      !lower.includes(email?.toLowerCase()) &&
      !lower.includes(phone) &&
      !lower.includes(fax) &&
      !lower.includes("fax") &&
      !lower.includes("office") &&
      !lower.includes("www") &&
      !lower.includes(".com") &&
      !lower.includes("http")
    );
  });

  name = filteredLines.find(line => !/\d/.test(line) && line.length < 30) || "";

  const nameIndex = filteredLines.indexOf(name);
  if (nameIndex !== -1 && filteredLines[nameIndex + 1]) {
    const possibleDesignation = filteredLines[nameIndex + 1];

    if (possibleDesignation.length < 40 && !/\d/.test(possibleDesignation)) {
      designation = possibleDesignation;
    }
  }

  const ignoreWords = [name, designation];
  const possibleCompanyLines = filteredLines.filter(line => !ignoreWords.includes(line));

  company_name =
    possibleCompanyLines.find(line => line.length < 40 && !/\d/.test(line)) || "";
  company_name = company_name.replace(/[^\w\s]/gi, "").trim();

  lines.forEach(line => {
    const lower = line.toLowerCase();

    if (
      /\d/.test(line) &&
      (
        lower.includes("road") ||
        lower.includes("street") ||
        lower.includes("nagar") ||
        lower.includes("india") ||
        lower.includes("ca") ||
        lower.includes("pune") ||
        lower.includes("mumbai") ||
        lower.includes("#") ||
        lower.match(/\d{5}/)
      )
    ) {
      addressParts.push(line);
    }
  });

  const address = addressParts.join(", ");

  return {
    name,
    designation,
    company_name,
    email,
    phone,
    fax,
    website,
    address
  };
}

module.exports = router;
