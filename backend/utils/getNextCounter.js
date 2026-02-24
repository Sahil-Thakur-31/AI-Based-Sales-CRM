const Counter = require("../models/counter");

const getNextCounter = async (name) => {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { returnDocument: "after", upsert: true }
  );

  return counter.seq;
};

module.exports = getNextCounter;