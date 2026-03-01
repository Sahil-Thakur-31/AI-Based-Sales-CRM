const fs = require("fs");
const multer = require("multer");
const path = require("path");

const receiptDir = path.join(__dirname, "..", "uploads", "receipt");

if (!fs.existsSync(receiptDir)) {
  fs.mkdirSync(receiptDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, receiptDir);
  },
  filename: function (req, file, cb) {
    const uniqueName =
      req.user._id +
      "_" +
      Date.now() +
      path.extname(file.originalname);

    cb(null, uniqueName);
  },
});

module.exports = multer({ storage });
