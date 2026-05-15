const { getAIInsights, resolveRoleName, buildGlanceMetrics, getDateRange } = require("../services/aiInsightsService");

function extractTeamMemberIds(team) {
  const collect = (items) => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => (item && typeof item === "object" ? item.userId || item._id || item : item));
  };

  return [
    ...collect(team?.members),
    ...collect(team?.teamMembers),
    ...collect(team?.memberIds),
    ...collect(team?.teamLeads),
    team?.managerId,
    team?.manager,
    team?.managerRef,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function loadTeamModel() {
  try {
    return require("../models/Team");
  } catch (e1) {
    try {
      return require("../models/team");
    } catch (e2) {
      try {
        return require("../models/Teams");
      } catch (e3) {
        try {
          return require("../models/teams");
        } catch (e4) {
          console.error("[AI Insights] Cannot find Team model:", e4.message);
          throw new Error("Team model not found. Check model path.");
        }
      }
    }
  }
}

async function fetchInsights(req, res) {
  try {
    const user = req.user || {};
    const role = await resolveRoleName(user?.role);
    const teamId = String(req.query?.teamId || "").trim();
    console.log("[AI Insights] role:", role, "| teamId param:", teamId);

    if (req.query?.glanceFilter) {
      const glanceFilter = String(req.query.glanceFilter || "month").trim().toLowerCase();
      const dateRange = getDateRange(glanceFilter);
      const userId = String(user?._id || "").trim();
      let scope = "personal";
      let memberIds = userId ? [userId] : [];

      try {
        const Team = loadTeamModel();

        if (role === "admin") {
          scope = "company";
          memberIds = [];
        } else if (role === "manager") {
          const myTeam = await Team.findOne({
            $or: [
              { managerId: user?._id },
              { manager: user?._id },
              { managerRef: user?._id },
              { "teamLeads.userId": user?._id },
            ],
          }).lean();

          if (myTeam) {
            memberIds = Array.from(new Set([...extractTeamMemberIds(myTeam), userId].filter(Boolean)));
            scope = "team";
          }
        }

        if (teamId && teamId !== "all") {
          try {
            const team = await Team.findById(teamId).lean();
            if (team) {
              memberIds = Array.from(new Set(extractTeamMemberIds(team).filter(Boolean)));
              scope = "team";
            }
          } catch (e) {
            console.warn("[AI Insights Glance] Failed to load team members:", e?.message || e);
          }
        }
      } catch (e) {
        console.warn("[AI Insights Glance] Team model unavailable:", e?.message || e);
      }

      const glanceData = await buildGlanceMetrics(scope, userId, memberIds, dateRange);
      return res.status(200).json({
        mode: "glance",
        glanceMetrics: glanceData,
        activeFilter: glanceFilter,
      });
    }

    if (teamId === "all" && role === "admin") {
      try {
        const Team = loadTeamModel();
        const teams = await Team.find({}).lean();

        console.log("[AI Insights] Total teams found in DB:", teams.length);
        console.log(
          "[AI Insights] Team documents sample:",
          JSON.stringify((teams || []).slice(0, 2), null, 2)
        );

        if (!teams || teams.length === 0) {
          console.warn("[AI Insights] No teams found in database");
          return res.status(200).json({ mode: "teamList", teams: [] });
        }

        const normalizedTeams = teams
          .map((team) => ({
            _id: String(team?._id || ""),
            name:
              team?.name ||
              team?.teamName ||
              team?.title ||
              team?.team_name ||
              "Unnamed Team",
            managerName: team?.managerName || team?.manager || "",
            memberCount: Array.isArray(team?.members)
              ? team.members.length
              : Array.isArray(team?.teamMembers)
                ? team.teamMembers.length
                : Array.isArray(team?.memberIds)
                  ? team.memberIds.length
                  : 0,
          }))
          .filter((team) => team._id);

        console.log(
          "[AI Insights] Normalized teams:",
          JSON.stringify(normalizedTeams, null, 2)
        );

        return res.status(200).json({ mode: "teamList", teams: normalizedTeams });
      } catch (err) {
        console.error("[AI Insights] Error fetching teams:", err.message);
        return res.status(500).json({
          message: "Failed to fetch teams: " + err.message,
        });
      }
    }

    if (teamId && teamId !== "all" && role === "admin") {
      const result = await getAIInsights(user, "team", teamId);
      return res.status(200).json({
        ...result,
        mode: "team",
        teamName: result.teamName || result.evidence?.teamName || "",
      });
    }

    if (teamId && role === "manager") {
      const Team = loadTeamModel();
      const myTeam = await Team.findOne({ "teamLeads.userId": user?._id })
        .select("_id name")
        .lean();

      if (!myTeam?._id) {
        return res.status(404).json({
          message: "No team found for this manager",
        });
      }

      const result = await getAIInsights(user, "team", String(myTeam._id));
      return res.status(200).json({
        ...result,
        mode: "team",
        teamName: result.teamName || myTeam.name || "",
      });
    }

    if (!teamId && role === "admin") {
      const result = await getAIInsights(user, "company", null);
      return res.status(200).json({
        ...result,
        mode: "company",
        teamName: "",
      });
    }

    const result = await getAIInsights(user, "personal", null);
    return res.status(200).json({
      ...result,
      mode: "personal",
      teamName: "",
    });
  } catch (error) {
    console.error("AI Insights controller error:", error);
    return res.status(500).json({
      message: error?.message || "Failed to fetch AI insights",
    });
  }
}

module.exports = {
  fetchInsights,
  getAnalyzedInsights: fetchInsights,
};
