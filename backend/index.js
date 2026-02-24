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

require('./config/db');
const bodyparser = require('body-parser');
const cors = require('cors');

const app = express()
const myServer = http.createServer(app);
PORT = process.env.PORT || 8080;

app.use(bodyparser.json());
app.use(cors());

app.use('/auth',authRoute);
app.use("/users", userRoutes);
app.use("/uploads", express.static("uploads"));
app.use("/api/expenses", require("./routes/expenseRoutes"));


myServer.listen(PORT,()=>console.log('Server started on', PORT));