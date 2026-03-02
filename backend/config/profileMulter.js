const fs = require("fs");
const multer = require("multer");
const path = require("path");

const profileDir = path.join(__dirname, "..", "uploads", "profile_picture");

if (!fs.existsSync(profileDir)) {
  fs.mkdirSync(profileDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, profileDir);
  },
  filename: function (req, file, cb) {
    const prefix = req.user?._id || "profile";
    const uniqueName = `${prefix}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

module.exports = multer({ storage });
