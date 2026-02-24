const Counter = require("../models/counter");

const getNextCounter = async (counterType) => {
  const counter = await Counter.findOneAndUpdate(
    // { counterType: counterType.toUpperCase() }, // match your schema
    // { $inc: { value: 1 } },                     // increment correct field
    // { new: true, upsert: true }
    // { name },
    // { $inc: { seq: 1 } },
    // { returnDocument: "after", upsert: true }
  );

  return counter.value; // return updated number
};

module.exports = getNextCounter;