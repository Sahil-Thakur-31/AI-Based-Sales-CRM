const Source = require("../models/sources");

exports.getSources = async (req, res) => {

  const data = await Source.find({is_deleted: false})
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

    { returnDocument: "after" }

  );

  res.json(source);

};



exports.deleteSource = async (req, res) => {

  await Source.findByIdAndUpdate(
    req.params.id,
    {
      is_deleted: true,
      updatedAt: new Date()
    }
  );

  res.json({ message: "Source deleted" });

};

exports.activateSource = async (req, res) => {

  await Source.findByIdAndUpdate(
    req.params.id,
    {
      is_deleted: false,
      updatedAt: new Date()
    }
  );

  res.json({ message: "Source activated" });

};