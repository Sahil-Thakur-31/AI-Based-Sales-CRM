const Source = require("../models/sources");

exports.getSources = async (req, res) => {

  const data = await Source.find()
    .populate("createdBy", "name")
    .sort({ name: 1 });

  res.json(data);

};



exports.createSource = async (req, res) => {

  const source = await Source.create({

    name: req.body.name,
    url: req.body.url,
    createdBy: req.user._id,
    createdAt: new Date()

  });

  res.json(source);

};



exports.updateSource = async (req, res) => {

  const source = await Source.findByIdAndUpdate(

    req.params.id,

    {
      name: req.body.name,
      url: req.body.url,
      updatedAt: new Date()
    },

    { new: true }

  );

  res.json(source);

};



exports.deleteSource = async (req, res) => {

  await Source.findByIdAndDelete(req.params.id);

  res.json({ message: "Deleted" });

};