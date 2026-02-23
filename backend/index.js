const http = require('http')
const express = require('express')
require('dotenv').config()
const authRoute = require('./routes/authRoutes')
const roleRoutes = require('./routes/roleRoutes')
const userRoutes = require('./routes/userRoutes')
const crmSettingsRoutes = require("./routes/crmSettingsRoutes");
const productRoutes = require("./routes/productRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
require('./models/db')
const bodyparser = require('body-parser')
const cors = require('cors')

const app = express()
const myServer = http.createServer(app);
PORT = process.env.PORT || 8080;

app.use(bodyparser.json());
app.use(cors());

app.use('/auth',authRoute);
app.use("/roles", roleRoutes);
app.use("/users", userRoutes);
app.use("/uploads", express.static("uploads"));
app.use("/crm-settings", crmSettingsRoutes);
app.use("/products", productRoutes);
app.use("/api/notifications", notificationRoutes);
myServer.listen(PORT,()=>console.log('Server started on', PORT));