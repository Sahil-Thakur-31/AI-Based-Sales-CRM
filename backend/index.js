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
const leadsRoutes = require("./routes/leadsRoutes");
const locationRoutes = require("./routes/locationRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const dealsRoutes = require("./routes/dealsRoutes");
const clientRoutes = require("./routes/clientRoutes");
const quotationRoutes = require("./routes/quotationRoutes");
const taxRoutes = require("./routes/taxRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const quotationClausesRoutes = require("./routes/quotationClausesRoutes");
const followupsRoutes = require("./routes/followupsRoutes");
const mongoose = require("mongoose");
const Meeting = require("./models/meetings");
const teamRoutes = require("./routes/teamRoutes");
const ocrRoutes = require("./ocr/routes");
const eventsRoutes = require("./routes/eventsRoutes");
const aiLeadsRoutes = require("./routes/aiLeadsRoutes");
const { startNotificationEmailWorker } = require("./services/notificationEmailWorker");
const { startWhatsAppMeetingWorker } = require("./services/whatsappMeetingWorker");
const { startFollowupOverdueWorker } = require("./services/followupOverdueWorker");
const { startEventScraperScheduler } = require("./services/eventScraperScheduler");
const whatsappRoutes = require("./routes/whatsappRoutes.js");
const googleAuthRoutes = require("./routes/googleAuthRoutes");
const salesForecastRoutes = require("./routes/salesForecastRoutes");

require('./config/db');
const bodyparser = require('body-parser');
const cors = require('cors');
const adminDashboardRoutes = require("./routes/adminDashboardRoutes");
const managerDashboardRoutes = require("./routes/managerDashboardRoutes");
const userDashboardRoutes = require("./routes/userDashboardRoutes");
const dailyClosingRoutes = require("./routes/dailyClosingRoutes");

const app = express();
const myServer = http.createServer(app);

const PORT = process.env.PORT || 8080;

app.use(bodyparser.json({ limit: "50mb" }));
app.use(bodyparser.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());

app.use('/auth', authRoute);
app.use("/users", userRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/crm-settings", crmSettingsRoutes);
app.use("/products", productRoutes);
app.use("/notifications", notificationRoutes);
app.use("/roles", rolesRoutes);
app.use("/sources", sourcesRoutes);
app.use("/industries", industriesRoutes);
app.use("/leads", leadsRoutes);
app.use("/location", locationRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/deals", dealsRoutes);
app.use("/clients", clientRoutes);
app.use("/quotations", quotationRoutes);
app.use("/taxes", taxRoutes);
app.use("/organizations", organizationRoutes);
app.use("/quotation-clauses", quotationClausesRoutes);
app.use("/followups", followupsRoutes);
app.use("/teams", teamRoutes);
app.use("/events", eventsRoutes);
app.use("/ai-leads", aiLeadsRoutes);
app.use("/api/admin/dashboard", adminDashboardRoutes);
app.use("/api/manager/dashboard", managerDashboardRoutes);
app.use("/api/user/dashboard", userDashboardRoutes);
app.use("/daily-closing", dailyClosingRoutes);
app.use("/ocr", ocrRoutes);
app.use("/whatsapp", whatsappRoutes);
app.use("/auth/google", googleAuthRoutes);
app.use("/sales-forecast", salesForecastRoutes);


let backgroundWorkersStarted = false;

const startBackgroundWorkers = async () => {
  if (backgroundWorkersStarted) {
    return;
  }
  backgroundWorkersStarted = true;

  try {
    await Meeting.createCollection();
    console.log("meetings collection ensured");
  } catch (err) {
    if (!String(err?.message || "").toLowerCase().includes("already exists")) {
      console.error("Failed to ensure meetings collection:", err.message || err);
    }
  }

  // Start background workers only after DB is available.
  startNotificationEmailWorker();
  startWhatsAppMeetingWorker();
  startFollowupOverdueWorker();
  startEventScraperScheduler();
};

if (mongoose.connection.readyState === 1) {
  void startBackgroundWorkers();
} else {
  mongoose.connection.once("open", () => {
    void startBackgroundWorkers();
  });
}

myServer.listen(PORT, () => console.log('Server started on', PORT));
// trigger reload for python backend (v11 - Clean Start)!!!!!!!!!!!

