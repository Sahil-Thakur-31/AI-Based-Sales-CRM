const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema(
  {
    teamLeads: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
      },
    ],

    name: {
      type: String,
      trim: true,
      default: ""
    },

    members: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
      },
    ],

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  }
);

teamSchema.pre("validate", async function rejectDuplicateMembers() {
  const memberIds = (this.members || [])
    .map((member) => String(member.userId || ""))
    .filter(Boolean);

  if (memberIds.length !== new Set(memberIds).size) {
    throw new Error("A member can only be assigned once in a team");
  }

  if (memberIds.length) {
    const conflict = await this.constructor
      .findOne({
        _id: { $ne: this._id },
        "members.userId": { $in: memberIds },
      })
      .select("name")
      .lean();

    if (conflict) {
      throw new Error(
        `A member can only be assigned to one team. Already assigned to "${conflict.name || "Untitled Team"}"`
      );
    }
  }
});

module.exports = mongoose.model("Team", teamSchema);
