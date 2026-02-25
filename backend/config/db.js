const mongoose = require('mongoose')
require('dotenv').config()

 const dbUrl = process.env.CONN

mongoose.connect(dbUrl).then(()=>{
    console.log('DB connected');
}).catch((err)=>{
    console.log("Error: ",err);
})