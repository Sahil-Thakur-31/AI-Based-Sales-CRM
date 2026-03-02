const fs = require("fs");
const multer = require("multer");
const path = require("path");

const logoDir = path.join(__dirname, "..", "uploads", "organization_logo");

if (!fs.existsSync(logoDir)) {
  fs.mkdirSync(logoDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, logoDir);
  },
  filename: function (req, file, cb) {
    const prefix = req.user?._id || "organization";
    const uniqueName = `${prefix}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

module.exports = multer({ storage });
