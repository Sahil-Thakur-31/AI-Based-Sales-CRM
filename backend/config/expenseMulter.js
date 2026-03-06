const fs = require("fs");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

const receiptDir = path.join(__dirname, "..", "uploads", "receipt");

if (!fs.existsSync(receiptDir)) {
  fs.mkdirSync(receiptDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, receiptDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "") || "";
    const randomPart = crypto.randomBytes(6).toString("hex");
    const uniqueName =
      req.user._id +
      "_" +
      Date.now() +
      "_" +
      randomPart +
      ext.toLowerCase();

    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  if (String(file.mimetype || "").startsWith("image/") || file.mimetype === "application/pdf") {
    cb(null, true);
    return;
  }
  cb(new Error("Only image and PDF files are allowed for receipts"));
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
});
