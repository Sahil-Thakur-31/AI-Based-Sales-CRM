export const routeConfig = [

  // Dashboard
  { path: "/adminhome", title: "Admin Dashboard" },
  { path: "/managerhome", title: "Manager Dashboard" },

  // Admin Config Modules
  { path: "/products", title: "Products" },
  { path: "/taxes", title: "Taxes" },
  { path: "/roles", title: "Roles" },
  { path: "/industry", title: "Industry" },
  { path: "/sources", title: "Sources" },
  { path: "/organization", title: "Organization" },
  { path: "/quotation-clauses", title: "Quotation Clauses" },

  // Admin
  { path: "/manageusers", title: "Manage Users" },
  { path: "/user-form", title: "User Form" },

  // CRM
  { path: "/leads", title: "Leads" },
  { path: "/leads/new", title: "Add Lead" },
  { path: "/leads/:id", title: "Lead Details", dynamic: true },
  { path: "/clients", title: "Clients" },
  { path: "/clients/new", title: "Add Client" },
  { path: "/clients/:id", title: "Client Details", dynamic: true },
  { path: "/clients/:id/deals", title: "Client Deals", dynamic: true },
  { path: "/deals", title: "Deals" },
  { path: "/deals/:id", title: "Deal Details", dynamic: true },
  { path: "/quotations", title: "Quotations" },
  { path: "/quotations/new", title: "New Quotation" },
  { path: "/quotations/:id", title: "Quotation Details", dynamic: true },
  { path: "/notifications", title: "Notifications" },

  { path: "/followups", title: "Follow-ups" },
  { path: "/followups/add", title: "Add Followup and Meeting" },
  { path: "/daily-closing/form", title: "Daily Closing Form" },
  { path: "/daily-closing/report", title: "Daily Closing Report" },

  // Finance
  { path: "/sales-forecast", title: "Sales Forecasting" },
  { path: "/expenses", title: "Expenses" },

  // AI
  { path: "/ai-leads", title: "AI Lead Generation" },

  // Analytics
  { path: "/events", title: "Events & Expos" },
  { path: "/events/new", title: "Events & Expos" },
  { path: "/events/register", title: "Events & Expos" },
  { path: "/reports", title: "Reports" },

  // Team
  { path: "/team-dashboard", title: "Team Dashboard" },
  { path: "/team-setup", title: "Setup Team" },
  { path: "/team-targets", title: "Assign Team Targets" },
  { path: "/team-targets/admin", title: "Team Targets - Admin" },
  { path: "/team-targets/manage", title: "Member Targets - Manager" },

  // System
  { path: "/settings", title: "Settings" },
  { path: "/profile", title: "My Profile" },
  { path: "/calendar", title: "Calendar" },

];
