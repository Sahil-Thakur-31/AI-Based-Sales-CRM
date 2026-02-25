const dns = require("dns");
const mongoose = require("mongoose");
require("dotenv").config();

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const dbUrl = process.env.CONN;

mongoose.connect(dbUrl).then(() => {
  console.log("DB connected");
}).catch((err) => {
  console.log("Error: ", err);
});
