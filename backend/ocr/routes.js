const express = require("express");
const router = express.Router();
const multer = require("multer");
const ocrService = require("./service");
const fs = require("fs");
const path = require("path");

const uploadDir = path.join(__dirname, "..", "uploads", "ocr");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Images only"), false);
  },
});

router.post("/scan-business-card", upload.single("card"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });

  try {
    if (!ocrService.isReady()) {
      const status = typeof ocrService.getStatus === "function" ? ocrService.getStatus() : null;
      return res.status(503).json({
        error: status?.unavailableReason || "OCR engine is currently initializing, please wait 30 seconds and try again.",
      });
    }

    const { scanImage } = require("./service");
    const result = await scanImage(req.file.path, req.file.originalname || "");

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    // Debug raw line labels only when explicitly enabled.
    const debugLineLabels = String(process.env.OCR_DEBUG_LINE_LABELS || "0") === "1";
    if (debugLineLabels && Array.isArray(result.line_labels) && result.line_labels.length > 0) {
      console.log("\n=============================================");
      console.log(" OCR PREDICTION RESULTS (RAW LINE LABELS):");
      console.log("=============================================");
      result.line_labels.forEach((line) => {
        const label = String(line.label || "OTHER");
        const conf = Number(line.confidence || 0);
        const text = String(line.text || "");
        const paddedLabel = `[${label}]`.padEnd(14, " ");
        const paddedConf = `(Conf: ${conf.toFixed(2)})`.padEnd(13, " ");
        console.log(`${paddedLabel} ${paddedConf} -> \"${text}\"`);
      });
      console.log("=============================================\n");
    }

    // Final cleaned fields only (the output your frontend should use).
    console.log("OCR FINAL FIELDS:", result.fields || {});

    res.json({
      success: true,
      fields: result.fields || {},
      warning: result.warning || "",
      line_labels: result.line_labels || [],
    });
  } catch (err) {
    console.error("OCR scan route error:", err);
    res.status(500).json({ error: err.message || "OCR service error" });
  } finally {
    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, () => {});
    }
  }
});

module.exports = router;
