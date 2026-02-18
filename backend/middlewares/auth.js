const jwt = require('jsonwebtoken')

const ensureAuthenticated = (req,res,next) =>{
    const auth = req.headers['authorization'];
    if(!auth){
        return res.status(404).json({mag:'Unauthorized, JWT Token Required.'});
    }
    try{
        const decoded = jwt.verify(auth,process.env.JWT_SECRET);
        req.user = decoded;
        next();
    }catch(err){
        return res.statue(401).json({msg:'Unauthorized, Token Expired or wrong'});
    }
}

module.exports={
    ensureAuthenticated
};