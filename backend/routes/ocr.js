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

    // 1️⃣ OCR
    const result = await Tesseract.recognize(
      req.file.buffer,
      "eng"
    );

    const text = result.data.text;

    // 2️⃣ Parse
    const parsed = parseBusinessCard(text);

    // 3️⃣ Save Lead
    const newLead = await Leads.create({
      company_name: parsed.company_name,
      Address: parsed.address,
      website: parsed.website,
      status: "new",
      is_active: true
    });

    // 4️⃣ Save Contact
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


// function parseBusinessCard(text) {
//   const lines = text
//     .split("\n")
//     .map(l => l.trim())
//     .filter(l => l.length > 0);

//   const fullText = lines.join(" ");

//   // Email
//   const emailMatch = fullText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
//   const email = emailMatch ? emailMatch[0] : "";

//   // Phone
//   const phoneMatch = fullText.match(/(\+?\d[\d\s-]{8,}\d)/);
//   const phone = phoneMatch ? phoneMatch[0] : "";

//   // Website
//   const websiteMatch = fullText.match(/(https?:\/\/)?(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/);
//   const website = websiteMatch ? websiteMatch[0] : "";

//   // Name (first clean line without numbers)
//   const name = lines.find(l =>
//     !l.match(/\d/) &&
//     !l.includes("@") &&
//     !l.toLowerCase().includes("www") &&
//     l.length < 30
//   ) || "";

//   // Company name (line containing Pvt, Ltd, etc.)
//   const companyKeywords = ["pvt", "ltd", "llp", "industries", "solutions", "technologies", "corp"];
//   const company_name = lines.find(l =>
//     companyKeywords.some(k => l.toLowerCase().includes(k))
//   ) || "";

//   // Address (line containing India or Road etc.)
//   const address = lines.find(l =>
//     l.toLowerCase().includes("road") ||
//     l.toLowerCase().includes("street") ||
//     l.toLowerCase().includes("india") ||
//     l.toLowerCase().includes("nagar")
//   ) || "";

//   // Designation (line below name usually)
//   const nameIndex = lines.indexOf(name);
//   const designation = nameIndex !== -1 && lines[nameIndex + 1]
//     ? lines[nameIndex + 1]
//     : "";

//   return {
//     name,
//     designation,
//     phone,
//     email,
//     website,
//     company_name,
//     address
//   };
// }

function parseBusinessCard(text) {
  // 1️⃣ Clean & Normalize
  const lines = text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const fullText = lines.join(" ");

  let name = "";
  let designation = "";
  let company_name = "";
  let email = "";
  let phone = "";
  let fax = "";
  let website = "";
  let addressParts = [];

  // 2️⃣ Extract Email
  const emailMatch = fullText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (emailMatch) email = emailMatch[0];

  // 3️⃣ Extract Website
  const websiteMatch = fullText.match(/(https?:\/\/)?(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/);
  if (websiteMatch) {
    website = websiteMatch[0];
    if (!website.startsWith("http")) {
      website = "http://" + website;
    }
  }

  // 4️⃣ Extract Phones (Office + Fax)
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

  // 5️⃣ Remove Contact Lines
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

  // 6️⃣ Detect Name (first short clean line without numbers)
  name = filteredLines.find(line =>
    !/\d/.test(line) &&
    line.length < 30
  ) || "";

  // 7️⃣ Detect Designation (usually below name)
  const nameIndex = filteredLines.indexOf(name);
  if (nameIndex !== -1 && filteredLines[nameIndex + 1]) {
    const possibleDesignation = filteredLines[nameIndex + 1];

    if (
      possibleDesignation.length < 40 &&
      !/\d/.test(possibleDesignation)
    ) {
      designation = possibleDesignation;
    }
  }

  // 8️⃣ Detect Company
  // Company usually comes after designation OR big standalone word
  const ignoreWords = [name, designation];

  const possibleCompanyLines = filteredLines.filter(line =>
    !ignoreWords.includes(line)
  );

  // Take first remaining short text line as company
  company_name = possibleCompanyLines.find(line =>
    line.length < 40 && !/\d/.test(line)
  ) || "";

  // Remove special characters like "Google!"
  company_name = company_name.replace(/[^\w\s]/gi, "").trim();

  // 9️⃣ Address Detection
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
        lower.match(/\d{5}/) // zip code
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
