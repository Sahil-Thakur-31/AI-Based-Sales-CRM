const joi = require("joi")

const registerValidation = (req,res,next) =>{
    const schema = joi.object({
        name: joi.string().required().min(3).max(50),
        email: joi.string().email().required(),
        password: joi.string().required().min(6).max(128),
        role: joi.string().required(),   
        joinDate: joi.date()
    });
    const {error} = schema.validate(req.body);

    if(error){
        return res.status(400).send({msg:"bad Request",error});
    }
    next();
}

const loginValidation = (req,res,next) =>{
    const schema = joi.object({
        email: joi.string().email().required(),
        password: joi.string().required().max(128)
    });
    const {error} = schema.validate(req.body);

    if(error){
        return res.status(400).send({msg:"bad Request",error});
    }
    next();
}

module.exports={
    registerValidation,
    loginValidation
}
