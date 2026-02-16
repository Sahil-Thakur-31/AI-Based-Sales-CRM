const express = require('express')
const router = express.Router();

router.get('/login',(req,res)=>{
    res.send('Welcom to Login');
})

module.exports = router;