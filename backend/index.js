const http = require('http')
const express = require('express')
require('dotenv').config()
const authRoute = require('./routes/authRoutes')

const app = express()
const myServer = http.createServer(app);
PORT = process.env.PORT || 8080;

app.use('/auth',authRoute);

myServer.listen(PORT,()=>console.log('Server started'));