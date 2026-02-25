const http = require('http')
const express = require('express')
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

require('./config/db');
const bodyparser = require('body-parser');
const cors = require('cors');
const adminDashboardRoutes = require("./routes/adminDashboard.admin.routes");

const app = express();
const myServer = http.createServer(app);

const PORT = process.env.PORT || 8080;

app.use(bodyparser.json());
app.use(cors());

app.use('/auth',authRoute);
app.use("/users", userRoutes);
app.use("/uploads", express.static("uploads"));
app.use("/crm-settings", crmSettingsRoutes);
app.use("/products", productRoutes);
app.use("/notifications", notificationRoutes);
app.use("/roles", rolesRoutes);
app.use("/sources", sourcesRoutes);
app.use("/industries", industriesRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/admin/dashboard", adminDashboardRoutes);
myServer.listen(PORT,()=>console.log('Server started on', PORT));
