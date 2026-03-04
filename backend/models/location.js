const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({
 
  country: {
    type: String,
    trim: true
  },

  state: {
    type: String,
    trim: true
  },

  district: {
    type: String,
    trim: true
  },

  city: {
    type: String,
    trim: true
  },

  pincode: {
    type: String,
    trim: true
  },

  area: {
    type: String,
    trim: true
  },

  State: {
    type: String,
    trim: true
  },

  zone: {
    type: String,   // kept as string exactly as given
    trim: true
  },

  createdAt: {
    type: Date
  },

  updatedAt: {
    type: Date
  }

}, {
  collection: "location"
});

locationSchema.index({ pincode: 1 });
locationSchema.index({ country: 1, state: 1, city: 1, area: 1 });

locationSchema.pre("save", function syncLegacyAndNewFields() {
  if (this.state && !this.State) this.State = this.state;
  if (this.State && !this.state) this.state = this.State;

  if (this.area && !this.zone) this.zone = this.area;
  if (this.zone && !this.area) this.area = this.zone;
});

module.exports = mongoose.model("location", locationSchema);
