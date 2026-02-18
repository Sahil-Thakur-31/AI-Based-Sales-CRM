const http = require('http')
const express = require('express')
require('dotenv').config()
const authRoute = require('./routes/authRoutes')

require('./models/db')
const bodyparser = require('body-parser')
const cors = require('cors')

const app = express()
const myServer = http.createServer(app);
PORT = process.env.PORT || 8080;

app.use(bodyparser.json());
app.use(cors());

app.use('/auth',authRoute);

myServer.listen(PORT,()=>console.log('Server started'));