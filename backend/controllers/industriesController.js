const Industry = require("../models/industries");

exports.getIndustries = async (req, res) => {

  const data = await Industry.find()
    .sort({ name: 1 });

  res.json(data);

};



exports.createIndustry = async (req, res) => {

  const industry = await Industry.create({

    name: req.body.name,
    description: req.body.description,
    createdAt: new Date()

  });

  res.json(industry);

};



exports.updateIndustry = async (req, res) => {

  const industry = await Industry.findByIdAndUpdate(

    req.params.id,

    {
      name: req.body.name,
      description: req.body.description,
      updatedAt: new Date()
    },

    { new: true }

  );

  res.json(industry);

};



exports.deleteIndustry = async (req, res) => {

  await Industry.findByIdAndDelete(req.params.id);

  res.json({ message: "Deleted" });

};