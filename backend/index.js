const http = require('http')
const express = require('express')
const path = require("path");
require('dotenv').config()
const authRoute = require('./routes/authRoutes')
const userRoutes = require('./routes/userRoutes')
const crmSettingsRoutes = require("./routes/crmSettingsRoutes");
const productRoutes = require("./routes/productRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const rolesRoutes = require("./routes/roleRoutes");
const sourcesRoutes = require("./routes/sourcesRoutes");
const industriesRoutes = require("./routes/industriesRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const dealsRoutes = require("./routes/dealsRoutes");
const clientRoutes = require("./routes/clientRoutes");
const quotationRoutes = require("./routes/quotationRoutes");
const taxRoutes = require("./routes/taxRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const followupsRoutes = require("./routes/followupsRoutes");
const mongoose = require("mongoose");
const Meeting = require("./models/meetings");
const teamRoutes = require("./routes/teamRoutes");
const ocrRoutes = require("./routes/ocr");
const clientRoutes = require("./routes/clientRoutes");
const quotationRoutes = require("./routes/quotationRoutes");
const taxRoutes = require("./routes/taxRoutes");
const eventsRoutes = require("./routes/eventsRoutes");

require('./config/db');
const bodyparser = require('body-parser');
const cors = require('cors');
const adminDashboardRoutes = require("./routes/adminDashboardRoutes");

const app = express();
const myServer = http.createServer(app);

const PORT = process.env.PORT || 8080;

app.use(bodyparser.json());
app.use(cors());

app.use('/auth',authRoute);
app.use("/users", userRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/crm-settings", crmSettingsRoutes);
app.use("/products", productRoutes);
app.use("/notifications", notificationRoutes);
app.use("/roles", rolesRoutes);
app.use("/sources", sourcesRoutes);
app.use("/industries", industriesRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/deals", dealsRoutes);
app.use("/clients", clientRoutes);
app.use("/quotations", quotationRoutes);
app.use("/clients", clientRoutes);
app.use("/quotations", quotationRoutes);
app.use("/taxes", taxRoutes);
app.use("/organizations", organizationRoutes);
app.use("/followups", followupsRoutes);
app.use("/taxes", taxRoutes);
app.use("/events", eventsRoutes);
app.use("/api/admin/dashboard", adminDashboardRoutes);
app.use("/ocr", ocrRoutes);
app.use("/events", eventsRoutes);

mongoose.connection.once("open", async () => {
  try {
    await Meeting.createCollection();
    console.log("meetings collection ensured");
  } catch (err) {
    if (!String(err?.message || "").toLowerCase().includes("already exists")) {
      console.error("Failed to ensure meetings collection:", err.message || err);
    }
  }
});

myServer.listen(PORT,()=>console.log('Server started on', PORT));
