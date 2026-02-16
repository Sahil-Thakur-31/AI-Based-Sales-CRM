const mongoose = require('mongoose')

dbUrl = Process.env.CONN

mongoose.connect(dbUrl).then(()=>{
    console.log('DB connected');
}).catch((err)=>{
    console.log("Error: ",err);
})